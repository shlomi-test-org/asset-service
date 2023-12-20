const { utils } = require('dynamo-data-transform');

const ASSETS_TABLE = 'Assets';
const TENANT_TABLE = 'Tenants';

/**
 * @param {DynamoDBDocumentClient} ddb - dynamo db client of @aws-sdk https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb
 * @param {boolean} isDryRun
 * @returns the number of transformed items { transformed: number }
 *
 */
const transformUp = async ({ ddb, isDryRun}) => {
  const owners = await getOwners(ddb, isDryRun)

  const changeItemToActive = (item) => {
    return { ...item, is_active: true };
  };

  const isAwsAccountWithValidOwner = (owners) => (item)  => {
    const isAwsAsset = item.vendor === 'aws';
    const isAwsAccount = item.asset_type === 'aws_account';
    const isActiveFalse = item.is_active === false;
    return isAwsAsset && isAwsAccount && isActiveFalse && owners.includes(item.owner)
}

  return transformedFilteredItems(ddb, ASSETS_TABLE, changeItemToActive, isDryRun, isAwsAccountWithValidOwner(owners) )
};

const getOwners = async (ddb) => {
  let lastEvalKey;
  let preparationData = [];

  let scannedAllItems = false;

  while (!scannedAllItems) {
    const { Items, LastEvaluatedKey } = await utils.getItems(ddb, lastEvalKey, TENANT_TABLE);
    lastEvalKey = LastEvaluatedKey;

    const currentPreparationData = Items.map((item) => {
      const isInstallationType = item.type === 'Installation';
      const isAwsVendor = item.vendor === 'aws';
      const isActive = item.is_active === true;

      if (isInstallationType && isAwsVendor && isActive) {
        return item.owner;
      }
    }).filter(owner => owner);

    preparationData = [...preparationData, ...currentPreparationData]

    scannedAllItems = !lastEvalKey;
  }
  return preparationData;
};

const transformedFilteredItems = async (ddb, tableName, transformer, isDryRun, filterFunction) => {
  let lastEvalKey;
  let transformedItemsKeys = [];

  let scannedAllItems = false;

  while (!scannedAllItems) {
    const { Items, LastEvaluatedKey } = await utils.getItems(ddb, lastEvalKey, tableName);
    lastEvalKey = LastEvaluatedKey;

    const filteredItems = Items.filter(filterFunction)
    const updatedItems = filteredItems.map(transformer);

    if (!isDryRun && updatedItems.length > 0) {
      if (updatedItems?.length) await utils.batchWriteItems(ddb, tableName, updatedItems);
      transformedItemsKeys = transformedItemsKeys.concat(updatedItems.map((item) => `${item.PK}-${item.SK}`));
    } else {
      console.info(updatedItems, 'updatedItems');
    }

    scannedAllItems = !lastEvalKey;
  }

  return { transformed: transformedItemsKeys.length };
};

module.exports = {
  transformUp,
  transformationNumber: 1,
};
