const { utils } = require("dynamo-data-transform");

const {
  getGithubTenantInfo,
  getGithubBranchProtectionRules,
} = require("../../data-transformations-utils/github-utils");

const {
  getGithubSecretForTenant,
  getTenantsWithGithubInstallation,
  getTenantGithubRepoAssets,
} = require("../../data-transformations-utils/aws-utils");

const ASSETS_TABLE = "Assets";
const TENANT_TABLE = "Tenants";
const DB_CHUNK_SIZE = 25;
const TENANT_BATCH_SIZE = 30;
const ASSET_BATCH_SIZE = 25;
const LAST_EVALUATED_KEY = {
  PK: "TENANT#b57c5e5b-7e8f-407b-8d9c-b3a0abc362f5",
  GSI1PK: "TYPE#Installation#ACTIVE#True",
  SK: "VENDOR#github#APP_ID#142441#INSTALLATION_ID#27279855",
};
let total_tenants = 0;
let total_assets = 0;
const TENANTS_TO_INCLUDE = [
  // re-run failed tenants
  {
    tenant_id: "TENANT#f43bb8d8-13be-40da-bf62-59ec9034dc0e",
    owner: "FranklinChen",
  },
];

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
  const { Items: tenants, LastEvaluatedKey } =
    await getTenantsWithGithubInstallation(
      ddb,
      TENANT_BATCH_SIZE,
      LAST_EVALUATED_KEY
    );
  console.log(`*** Got ${tenants.length} Tenants from ${TENANT_TABLE}`);
  console.log(
    `*** Got ${TENANTS_TO_INCLUDE.length} Tenants to include (re-run)`
  );
  console.log(`*** last Evaluated key: ${JSON.stringify(LastEvaluatedKey)}`);

  // get app_id from first tenant if the list is not empty
  const app_id = tenants.length > 0 ? tenants[0].app_id : null;

  const githubSecret = await getGithubSecretForTenant(app_id);
  if (!githubSecret) {
    return [];
  }

  const tenantsTOProcess = [
    ...tenants,
    ...(TENANTS_TO_INCLUDE.length ? TENANTS_TO_INCLUDE : []),
  ];

  for (const tenant of tenantsTOProcess) {
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
  console.log(`*** last Evaluated key: ${JSON.stringify(LastEvaluatedKey)}`);

  return { transformed: total_assets };
};

module.exports = {
  transformUp,
  transformationNumber: 9,
};
