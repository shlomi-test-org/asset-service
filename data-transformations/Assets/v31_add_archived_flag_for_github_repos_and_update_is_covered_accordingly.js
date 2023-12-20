const { utils } = require("dynamo-data-transform");

const {
  getGithubTenantInfo,
} = require("../../data-transformations-utils/github-utils");

const {
  getGithubSecretForTenant,
  getTenantsWithGithubInstallation,
  getTenantGithubRepoAssets,
} = require("../../data-transformations-utils/aws-utils");

const ASSETS_TABLE = "Assets";
const TENANT_TABLE = "Tenants";
const DB_CHUNK_SIZE = 25;
const TENANT_BATCH_SIZE = 1000;
const ASSET_BATCH_SIZE = 25;
const LAST_EVALUATED_KEY = {
  PK: "TENANT#ed9631a3-12c5-4739-a5f5-da368373ef69",
  SK: "VENDOR#github#APP_ID#142441#INSTALLATION_ID#37865231",
  GSI5PK: "TYPE#Installation#ACTIVE#True",
  GSI5SK: "SEQUENCE#2QEwvYZznmdGUxwMo81xqULANab",
}

let total_tenants = 0;
let total_assets = 0;

const enrichAssetWithGithubInfo = async (githubSecret, tenant, assets) => {
  const assetsToUpdate = [];

  const response = await getGithubTenantInfo(githubSecret, tenant, assets);

  if (!response) {
    return assetsToUpdate;
  }

  const { token, repositories } = response;

  if (!repositories || !token) {
    console.warn("No repositories or token found in the response.");
    return assetsToUpdate;
  }

  const modifiedAt = new Date().toISOString().slice(0, -1) + "000";

  for (const asset of assets) {
    let updatedAsset = null;

    //get repository info from repositories by name
    const repository = repositories.find(
      (repo) => repo.name === asset.asset_name
    );

    if (repository) {
      const { id, archived } = repository;

      console.log(
        `\t Repository: ${asset.asset_name} (${asset.asset_id}) - Archived: ${archived}`
      );

      updatedAsset = {
        ...asset,
        modified_at: modifiedAt,
        is_archived: archived,
        is_covered:
          asset.is_covered === false ? false : archived === true ? false : true,
      };
      console.log(updatedAsset);

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

  for (const tenant of tenants) {
    console.log(tenant.tenant_id);
  }
  // get app_id from first tenant if the list is not empty
  const app_id = tenants.length > 0 ? tenants[0].app_id : null;

  const githubSecret = await getGithubSecretForTenant(app_id);
  if (!githubSecret) {
    return [];
  }
  for (const tenant of tenants) {
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
      for (const asset of assets) {
        console.log(`Asset name: ${asset.asset_name}`);
      }
    }

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
  console.log(`*** Got ${tenants} Tenants from ${TENANT_TABLE}`);
  // console.log(
  //   `*** Got ${TENANTS_TO_INCLUDE.length} Tenants to include (re-run)`
  // );
  console.log(`*** last Evaluated key: ${JSON.stringify(LastEvaluatedKey)}`);

  //

  // }

  console.log(`*** Total tenants: ${total_tenants} ***`);
  console.log(`*** Total assets: ${total_assets} ***`);
  console.log(`*** last Evaluated key: ${JSON.stringify(LastEvaluatedKey)}`);

  return { transformed: total_assets };
};

module.exports = {
  transformUp,
  transformationNumber: 31,
};