const { utils } = require("dynamo-data-transform");

const {
  getGithubTenantInfo,
  getGithubBranchProtectionRules,
} = require("../../data-transformations-utils/github-utils");

const {
  getGithubSecretForTenant,
  getTenantGithubRepoAssets,
} = require("../../data-transformations-utils/aws-utils");

const ASSETS_TABLE = "Assets";
const DB_CHUNK_SIZE = 25;
const ASSET_BATCH_SIZE = 25;

let total_tenants = 0;
let total_assets = 0;
const TENANTS_TO_INCLUDE = [
  // already run on prod
  // {
  //   tenant_id: "128efeff-988e-453c-9b2d-2090f97212a1",
  //   owner: "chrismith-equinix",
  //   app_id: "142441",
  //   installation_id: "27302262",
  // },
  // {
  //   tenant_id: "dfc1a05d-074d-4672-9b56-45126bc7884b",
  //   owner: "jasonappah",
  //   app_id: "142441",
  //   installation_id: "26703120",
  // },
];

async function handleUnprocessableEntity(ddb, githubSecret) {
  for (const tenant of TENANTS_TO_INCLUDE) {
    const assets = await getTenantGithubRepoAssets(ddb, tenant);
    const assetsToUpdate = [];

    // for each asset try to get the github info, if not accessible, then set is_active to false
    for (const asset of assets) {
      console.log(
        `\t ${tenant.tenant_id} (${tenant.owner}) - Checking Asset: ${asset.asset_name} (${asset.asset_id})`
      );
      const github_info = await getGithubTenantInfo(githubSecret, tenant, [
        asset,
      ]);

      const modifiedAt = new Date().toISOString().slice(0, -1) + "000";

      if (!github_info) {
        console.log(
          `\t\t ERROR: No response from github for tenant: ${tenant.tenant_id} (${tenant.owner}) and asset: ${asset.asset_id} - Setting is_active to false`
        );
        assetsToUpdate.push({
          ...asset,
          modified_at: modifiedAt,
          is_active: false,
          is_covered: false,
          GSI1SK: `TENANT#${tenant.tenant_id}#ACTIVE#false`,
          GSI2PK: `TENANT#${tenant.tenant_id}#ACTIVE#false`,
          GSI2SK: `TENANT#${tenant.tenant_id}#ACTIVE#false`,
          GSI3PK: `TENANT#${tenant.tenant_id}#ACTIVE#false`,
        });
      }

      if (assetsToUpdate.length > 0) {
        console.log(
          `\t\t ${tenant.tenant_id} (${tenant.owner}) - Updating ${assetsToUpdate.length} assets`
        );
        await utils.batchWriteItems(ddb, ASSETS_TABLE, assetsToUpdate);
      } else {
        console.log(
          `\t\t ${tenant.tenant_id} (${tenant.owner}) - No assets to update`
        );
      }
    }
  }
}

const enrichAssetWithGithubInfo = async (githubSecret, tenant, assets) => {
  const assetsToUpdate = [];

  const response = await getGithubTenantInfo(githubSecret, tenant, assets);

  if (!response) {
    return assetsToUpdate;
  }

  const { token, repositories } = response;

  const modifiedAt = new Date().toISOString().slice(0, -1) + "000";

  for (const asset of assets) {
    let updatedAsset = null;

    //get repository info from repositories by name
    const repository = repositories.find(
      (repo) => repo.name === asset.asset_name
    );

    if (repository) {
      const { id, private, default_branch } = repository;

      console.log(`\t Repository: ${asset.asset_name} (${asset.asset_id})`);

      updatedAsset = {
        ...asset,
        modified_at: modifiedAt,
        external_repository_id: id,
        default_branch: default_branch,
        is_private: private,
      };

      const branchProtectionRules = await getGithubBranchProtectionRules(
        asset.owner,
        asset.asset_name,
        default_branch,
        token
      );

      if (branchProtectionRules) {
        const isProtectedByJit = branchProtectionRules.includes("Jit Security");
        console.log(
          `\t\t Branch protection rules exists, is protected by jit? ${isProtectedByJit}`
        );

        updatedAsset = {
          ...updatedAsset,
          is_branch_protected_by_jit: isProtectedByJit,
        };
      } else {
        console.log(
          `\t\t No branch protection rules, setting is_protected_by_jit to false`
        );
        updatedAsset = {
          ...updatedAsset,
          is_branch_protected_by_jit: false,
        };
      }

      assetsToUpdate.push(updatedAsset);
    } else {
      console.log(
        `\t\t ERROR: No repository found for ${asset.asset_id} - Moving on`
      );
    }
  }

  return assetsToUpdate;
};

/**
 * @param {DynamoDBDocumentClient} ddb - dynamo db client of @aws-sdk https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb
 * @param {boolean} isDryRun
 * @returns the number of transformed items { transformed: number }
 *
 */
const transformUp = async ({ ddb, isDryRun }) => {
  console.log(
    `*** Got ${TENANTS_TO_INCLUDE.length} Tenants to include (re-run)`
  );

  // Handle status code: 422 - Unprocessable Entity
  //  There is at least one repository that does not exist or is not accessible to the parent installation
  // await handleUnprocessableEntity(ddb, githubSecret);

  if (TENANTS_TO_INCLUDE.length > 0) {
    // get app_id from first tenant if the list is not empty
    const app_id = TENANTS_TO_INCLUDE[0].app_id;

    const githubSecret = await getGithubSecretForTenant(app_id);
  }

  for (const tenant of TENANTS_TO_INCLUDE) {
    console.log("\n");
    console.log("*".repeat(100));
    console.log(
      `\t Processing tenant:${tenant.tenant_id} owner:${tenant.owner}`
    );
    console.log("*".repeat(100));

    const assets = await getTenantGithubRepoAssets(ddb, tenant);

    if (!assets) {
      console.log(`\t No assets for tenant: ${tenant.tenant_id}`);
      continue;
    } else {
      console.log(
        `Got ${assets.length} assets for tenant: ${tenant.tenant_id}`
      );

      // enrich asset with github info - chunk assets into batches of 25
      const assetsToUpdate = [];

      for (let i = 0; i < assets.length; i += ASSET_BATCH_SIZE) {
        const assetsChunk = assets.slice(i, i + ASSET_BATCH_SIZE);

        const res = await enrichAssetWithGithubInfo(
          githubSecret,
          tenant,
          assetsChunk
        );

        assetsToUpdate.push(...res);
      }

      // for each 25 assets, update them
      for (let i = 0; i < assetsToUpdate.length; i += DB_CHUNK_SIZE) {
        const chunk = assetsToUpdate.slice(i, i + DB_CHUNK_SIZE);

        await utils.batchWriteItems(ddb, ASSETS_TABLE, chunk);
      }
      console.log(`\n\t ${assetsToUpdate.length} assets were updated`);

      total_assets += assets.length;
    }

    total_tenants += 1;
  }

  console.log(`*** Total tenants: ${total_tenants} ***`);
  console.log(`*** Total assets: ${total_assets} ***`);

  return { transformed: total_assets };
};

module.exports = {
  transformUp,
  transformationNumber: 15,
};
