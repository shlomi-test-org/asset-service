const { utils } = require('dynamo-data-transform');
const { ScanCommand } = require('@aws-sdk/lib-dynamodb');

const ASSETS_TABLE = 'Assets';

const TENANT_ID = '4d44ae64-1ea4-4eba-9867-ed93c22e44f3'; // Energi-ai Tenant ID

const EnergiAIAssets = [
  "energi-integration-jcloud",
  "energi-integration-nordpool",
  "energi-finance-csv-uploader",
  "energi-db-service",
  "energi-finance-24sevenoffice",
  "energi-actions-env-to-app-engine",
  "energi_extraction_from_invoices",
  "energi-integration-24sevenoffice",
  "github-actions-env-from-yaml",
  "energi-integration-elhub",
  "energi-nest-logger",
  "energi-test-automation",
  "energi_ai_experiments",
  "energi-auth-service",
  "energi-dashboard-back-end",
  "energi-notification-service",
  "energi-proff-no",
  "energi-site",
  "energi-integration-elhub-nodejs",
  "energi-ai-infrastructure",
  "energi-dashboard",
  "energi-areas-mapping-cf",
  "energi-nordpool-elhub-calculation-cf",
  "energi_ml",
  "energi-all-web",
  "energi-email",
  "energi-nordpool",
  "finance-base-emissions-cf",
];

const getItems = async (ddb, lastEvalKey) => {
  let energiAIAssetNamesObject = {};
  EnergiAIAssets.forEach((value, index) => {
    const assetNameKey = ':asset_name' + index;
    energiAIAssetNamesObject[assetNameKey.toString()] = value;
  });

  const params = {
    TableName: ASSETS_TABLE,
    ExclusiveStartKey: lastEvalKey, // if `lastEvalKey` is null, it will start from the beginning
    FilterExpression:
      '#pk = :pk and asset_name IN (' +
      Object.keys(energiAIAssetNamesObject).toString() +
      ')',
    ExpressionAttributeNames: { '#pk': 'PK' },
    ExpressionAttributeValues: {
      ':pk': 'TENANT#' + TENANT_ID,
      ...energiAIAssetNamesObject,
    },
  };

  const scanCommand = new ScanCommand(params);

  return await ddb.send(scanCommand);
};

const transformUp = async ({ ddb, isDryRun }) => {
  const date = new Date();
  const isoDate = date.toISOString();
  const modified_at = isoDate.slice(0, isoDate.length - 1) + '000';

  const changeItemToDeactivated = (item) => {
    return {
      ...item,
      modified_at: modified_at,
      is_active: true,
      is_covered: true,
      GSI1SK: item.GSI1SK.replace('false', 'true'),
      GSI2PK: item.GSI2PK.replace('false', 'true'),
      GSI2SK: item.GSI2SK.replace('false', 'true'),
      GSI3PK: item.GSI3PK.replace('false', 'true'),
    };
  };

  return transformedFilteredItems(ddb, changeItemToDeactivated, isDryRun);
};

const transformedFilteredItems = async (ddb, transformer, isDryRun) => {
  let lastEvalKey;
  let transformedItemsKeys = [];

  let scannedAllItems = false;

  while (!scannedAllItems) {
    const { Items, LastEvaluatedKey } = await getItems(ddb, lastEvalKey);
    lastEvalKey = LastEvaluatedKey;

    const updatedItems = Items.map(transformer);

    if (!isDryRun && Items.length > 0) {
      await utils.insertItems(ddb, ASSETS_TABLE, updatedItems);
      transformedItemsKeys = transformedItemsKeys.concat(
        updatedItems.map((item) => `${item.PK}-${item.SK}`)
      );
    } 
    
    console.info(updatedItems, 'Items', updatedItems.length);
    scannedAllItems = !lastEvalKey;
  }

  return { transformed: transformedItemsKeys.length };
};

module.exports = {
  transformUp,
  transformationNumber: 22,
};
