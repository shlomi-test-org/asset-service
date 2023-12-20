const { utils } = require('dynamo-data-transform');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ASSETS_TABLE = 'Assets';

const TENANT_ID = 'TENANT#168d5ba8-2e13-45e0-8800-fd2b50f66cd5'; // Neuroblade Tenant ID

const NeuroBladeDuplicatedAssets = [
  "ASSET#7be92bfa-ed28-4aee-a953-ab10758774a1",
  "ASSET#6c376569-4986-48e1-ba86-81d951ec0b8e",
  "ASSET#21cda9b5-386c-4e33-9aab-7076b597b9ca"
]; 


const getItems = async (ddb) => {
  let items = [];
  let lastEvalKey;
  let promises = NeuroBladeDuplicatedAssets.map(async (asset_id, index) => {
    
      params = {
        TableName: 'Assets',
        KeyConditionExpression: 'PK = :pk and SK = :sk',
        ExpressionAttributeValues: {
          ':pk': TENANT_ID,
          ':sk': asset_id
        },
        ExclusiveStartKey: lastEvalKey,
      }

      queryCommand = new QueryCommand(params)
      const { Items, LastEvaluatedKey } = await ddb.send(queryCommand)
      lastEvalKey = LastEvaluatedKey;

      return Items[0]
    });

  items = await Promise.all(promises)

  return items
};

const transformUp = async ({ ddb, isDryRun }) => {
  const items = [] // await getItems(ddb) # IT ALREADY RAN IN PROD
  const deletedItems = await utils.deleteItems(ddb, ASSETS_TABLE, items, isDryRun)

  return deletedItems
};

module.exports = {
  transformUp,
  transformationNumber: 6,
};
