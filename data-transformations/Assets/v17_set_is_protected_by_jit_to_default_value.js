const { utils } = require("dynamo-data-transform");


const {
  getGithubRepoAssetsWithNoBranchProtection,getTenantsWithGithubInstallation
} = require("../../data-transformations-utils/aws-utils");

const ASSETS_TABLE = "Assets";
const TENANT_TABLE = "Tenants";
const DB_CHUNK_SIZE = 25;
let total_tenants = 0;
let total_assets = 0;

const getAssetsToUpdate = async (assets) => {
  const assetsToUpdate = [];
  const modifiedAt = new Date().toISOString().slice(0, -1) + "000"
  for (const asset of assets) {
    if (asset.is_branch_protected_by_jit) {
      continue
    }
    let updatedAsset = {
        ...asset,
        modified_at: modifiedAt,
        is_branch_protected_by_jit: false,
    };
    assetsToUpdate.push(updatedAsset);
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
  const { Items: tenantsToProcess, LastEvaluatedKey } =
    await getTenantsWithGithubInstallation(
      ddb,
      0,
      ""
    );
  console.log(`*** Got ${tenantsToProcess.length} Tenants from ${TENANT_TABLE}`);
  for (const tenant of tenantsToProcess) {
    console.log("\n");
    console.log("*".repeat(100));
    console.log(
      `\t Processing tenant:${tenant.tenant_id} owner:${tenant.owner}`
    );
    console.log("*".repeat(100));

    const assets = await getGithubRepoAssetsWithNoBranchProtection(ddb, tenant);

    if (!assets) {
      console.log(`\t No assets to update for tenant: ${tenant.tenant_id}`);
      continue;
    } else {
      console.log(
        `Got ${assets.length} assets to update for tenant: ${tenant.tenant_id}`
      );

      const assetsToUpdate = await getAssetsToUpdate(assets);

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
  transformationNumber: 17,
};
