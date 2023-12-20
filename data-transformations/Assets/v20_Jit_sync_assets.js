const {
    getTenantGithubInstallation,
    getTenantInactiveGithubRepoAssetsWithBadGSI3PK,
} = require("../../data-transformations-utils/aws-utils");

const {utils} = require("dynamo-data-transform");
const uuidv4 = require("uuid");

const TENANT_ID = '2c799663-2852-4038-a261-b208611f5e2b'; // Jit Tenant ID

const ASSETS_TABLE = 'Assets';

const getTenantOutOfSyncGithubRepoAssets = async (ddb, tenant_id) => {
    const {Items: assets} = await getTenantInactiveGithubRepoAssetsWithBadGSI3PK(ddb, tenant_id);
    console.log(`*** Got ${assets.length} out of sync github repo assets from db`);

    return assets;
};

const getTenant = async (ddb, tenant_id) => {
    const {Items: tenants, LastEvaluatedKey} = await getTenantGithubInstallation(ddb, tenant_id);
    console.log(`*** Got ${tenants.length} tenants`);

    const tenant = tenants.length > 0 ? tenants[0] : null;
    return tenant;
};

/**
 * @param {DynamoDBDocumentClient} ddb - dynamo db client of @aws-sdk https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb
 * @param {boolean} isDryRun
 * @returns the number of transformed items { transformed: number }
 *
 */
const transformUp = async ({ddb, isDryRun}) => {
    const assetsToUpdate = [];

    // get out of sync github repo assets from db (GSI3PK contains #ACTIVE#true when is_active=false)
    const assets = await getTenantOutOfSyncGithubRepoAssets(ddb, TENANT_ID);

    // update GSI1SK, GSI2PK, GSI2SK and GSI3PK to contains #ACTIVE#false
    for (const asset of assets) {
        console.log(`*** Asset ${asset.asset_name} is out of sync`);
        updatedAsset = {
            ...asset,
            GSI1SK: `TENANT#${TENANT_ID}#ACTIVE#false`,
            GSI2PK: `TENANT#${TENANT_ID}#ACTIVE#false`,
            GSI2SK: `TENANT#${TENANT_ID}#ACTIVE#false`,
            GSI3PK: `TENANT#${TENANT_ID}#ACTIVE#false`,
        };
        assetsToUpdate.push(updatedAsset);
    }
    console.log(`*** Got ${assetsToUpdate.length} assets to update`);

    // update assets in db
    await utils.insertItems(ddb, ASSETS_TABLE, assetsToUpdate, isDryRun);

    return {transformed: assetsToUpdate.length};
};

module.exports = {
    transformUp,
    transformationNumber: 20,
};

