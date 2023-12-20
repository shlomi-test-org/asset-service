/*
This migration will set the missing is_covered attribute to false
fot JIt tenant 
 "PK": "TENANT#d94c09b8-35be-445a-a174-1e2860af8778",
 "SK": "ASSET#ac2a37c6-9004-41b5-b03c-01678785f3f8",
"asset_name": "moises-test",
 */

const { utils } = require("dynamo-data-transform");
const { getAsset } = require("../../data-transformations-utils/aws-utils");

const ASSETS_TABLE = "Assets";

const TENANT_ID = "d94c09b8-35be-445a-a174-1e2860af8778"; // Jit Tenant ID
const ASSET_ID = "ac2a37c6-9004-41b5-b03c-01678785f3f8"; // moises-test Asset ID

let updatedCount = 0;

const setIsCovered = (item, isCovered) => {
  const date = new Date();
  const isoDate = date.toISOString();
  const modified_at = isoDate.slice(0, isoDate.length - 1) + "000";

  return {
    ...item,
    modified_at: modified_at,
    is_covered: isCovered,
  };
};

const transformUp = async ({ ddb, isDryRun }) => {
  const itemToUpdate = await getAsset(ddb, TENANT_ID, ASSET_ID);

  if (!itemToUpdate) {
    console.log(
      `Skipping, Item not found for tenant ${TENANT_ID} and asset ${ASSET_ID}`
    );
  } else {
    // We want to update the item twice, once to set is_covered to true, and then to false
    // This will trigger the flow that listens to the is_covered attribute changes from true to false
    const updatedItemTrue = setIsCovered(itemToUpdate, true);
    const updatedItemFalse = setIsCovered(itemToUpdate, false);

    if (!isDryRun) {
      await utils.batchWriteItems(ddb, ASSETS_TABLE, [updatedItemTrue]);
      await utils.batchWriteItems(ddb, ASSETS_TABLE, [updatedItemFalse]);
      updatedCount++;
    } else {
      console.info(updatedItem, "Item");
    }
  }

  return { transformed: updatedCount };
};

module.exports = {
  transformUp,
  transformationNumber: 32,
};
