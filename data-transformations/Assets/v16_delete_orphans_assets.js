const { utils } = require("dynamo-data-transform");
const { QueryCommand } = require("@aws-sdk/lib-dynamodb");

const ASSETS_TABLE = "Assets";

const ORPHANS_ASSETS_TENANT_IDS = [
  // "TENANT#1ef34c5d-3ec5-46c2-8890-74fc386c50ce",
  // "TENANT#1e65e6cd-7eb6-4f54-8509-0f63f43e3da8",
  // "TENANT#30e1d693-1ee7-4115-970d-244cb33c3bc9",
  // "TENANT#23727695-a0cf-42c8-a65b-9c55680cd923",
  // "TENANT#575f46c1-5afb-44c3-baa7-344c8da64367",
  // "TENANT#5259a073-2991-4308-aa7f-b9b3d778c7d7",
  // "TENANT#614d418b-4499-4264-b3e8-e58b976d2837",
  // "TENANT#33b55a56-4e79-4391-9581-d6437ed4209c",
  // "TENANT#aa651707-41ca-4bee-b6ca-ce95398a09ad",
  // "TENANT#e3c15f03-31ee-4e06-9b5a-570f075eddff",
  "TENANT#af356bfe-d792-469b-9260-8df58e7d45a7",
  "TENANT#650c1c99-1e76-4621-9cc5-18f6aa8d2410",
  "TENANT#dcb6e366-c21a-42e4-a46d-17fb8159fb83",
  "TENANT#c8259c21-616c-45b2-b8e9-3ec15cb12df9",
  "TENANT#728400c5-60a4-4eda-a0ec-15656846d85b",
  "TENANT#69369626-744f-4355-851f-aedcda831a18",
  "TENANT#e4c0ab62-0e28-4811-a4a4-4005069ebcdf"
];

const getItems = async (ddb, tenant_id) => {
  let items = [];
  let lastEvalKey;
  let moreItems = true;

  while (moreItems) {
    let params = {
      TableName: ASSETS_TABLE,
      KeyConditionExpression: "#PK = :pk",
      ExpressionAttributeNames: {
        "#PK": "PK",
      },
      ExpressionAttributeValues: {
        ":pk": tenant_id,
      },
      ExclusiveStartKey: lastEvalKey,
    };

    if (lastEvalKey) {
      params.ExclusiveStartKey = lastEvalKey;
    }

    let queryCommand = new QueryCommand(params);
    const { Items, LastEvaluatedKey } = await ddb.send(queryCommand);
    items = [...items, ...Items];
    lastEvalKey = LastEvaluatedKey;
    moreItems = lastEvalKey;
  }

  return items;
};

const transformUp = async ({ ddb, isDryRun }) => {
  console.log("Starting to delete orphans assets");

  let deletedItems = 0;

  for (const tenant_id of ORPHANS_ASSETS_TENANT_IDS) {
    console.log(`Starting to delete orphans assets for tenant ${tenant_id}`);
    const items = await getItems(ddb, tenant_id);

    console.log(`Got ${items.length} items for tenant ${tenant_id}`);
    if (items.length > 0) {
      const { transformed } = await utils.deleteItems(
        ddb,
        ASSETS_TABLE,
        items,
        isDryRun
      );
      console.log(`Deleted ${transformed} items for tenant ${tenant_id}`);

      deletedItems += transformed;
    }
  }

  console.log(`Deleted total of ${deletedItems} items`);
  return { transformed: deletedItems };
};

module.exports = {
  transformUp,
  transformationNumber: 16,
};