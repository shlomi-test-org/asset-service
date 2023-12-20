const {utils} = require('dynamo-data-transform');
const {ScanCommand} = require('@aws-sdk/lib-dynamodb');

const ASSETS_TABLE = 'Assets';

const TENANT_ID = '557a651c-e5c3-4029-b582-f4bb2743bcaf'; // Lumigo Tenant ID

const getItems = async (ddb, lastEvalKey) => {
    const params = {
        TableName: ASSETS_TABLE,
        ExclusiveStartKey: lastEvalKey, // if `lastEvalKey` is null, it will start from the beginning
        FilterExpression: '#pk = :pk',
        ExpressionAttributeNames: {'#pk': 'PK',},
        ExpressionAttributeValues: {':pk': 'TENANT#' + TENANT_ID,}
    };

    const scanCommand = new ScanCommand(params);

    return await ddb.send(scanCommand);

};


const transformUp = async ({ddb, isDryRun}) => {
    const date = new Date();
    const isoDate = date.toISOString();
    const modified_at = isoDate.slice(0, isoDate.length - 1) + '000';

    const changeItemToDeactivated = (item) => {
        return {
            ...item,
            modified_at: modified_at,
            is_active: false,
            is_covered: false,
            GSI1SK: item.GSI1SK.replace('true', 'false'),
            GSI2PK: item.GSI2PK.replace('true', 'false'),
            GSI2SK: item.GSI2SK.replace('true', 'false'),
            GSI3PK: item.GSI3PK.replace('true', 'false'),
        };
    };

    return transformedFilteredItems(ddb, changeItemToDeactivated, isDryRun);
};

const transformedFilteredItems = async (ddb, transformer, isDryRun) => {
    let lastEvalKey;
    let transformedItemsKeys = [];

    let scannedAllItems = false;

    while (!scannedAllItems) {
        const {Items, LastEvaluatedKey} = await getItems(ddb, lastEvalKey);
        lastEvalKey = LastEvaluatedKey;

        const updatedItems = Items.map(transformer);

        if (!isDryRun && Items.length > 0) {
            await utils.batchWriteItems(ddb, ASSETS_TABLE, updatedItems);
            transformedItemsKeys = transformedItemsKeys.concat(updatedItems.map((item) => `${item.PK}-${item.SK}`));
        } else {
            console.info(updatedItems, 'Items');
        }

        scannedAllItems = !lastEvalKey;
    }

    return {transformed: transformedItemsKeys.length};
};

module.exports = {
    transformUp,
    transformationNumber: 2,
};
