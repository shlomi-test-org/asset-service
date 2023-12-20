const {utils} = require('dynamo-data-transform');
const {QueryCommand} = require('@aws-sdk/lib-dynamodb');

const ASSETS_TABLE = 'Assets';

const TENANT_ID = '1b9952b6-d963-4886-a2da-37bf11ee1c69'; // crunchyroll Tenant ID
const REPO_ASSET_TYPE = 'repo';
const DOT_JIT_ASSET_NAME = '.jit';
const getItems = async (ddb, lastEvalKey) => {
    const params = {
        TableName: ASSETS_TABLE,
        FilterExpression: '#IS_COVERED <> :is_covered AND #ASSET_TYPE = :asset_type AND #ASSET_NAME <> :asset_name',
        ExclusiveStartKey: lastEvalKey, // if `lastEvalKey` is null, it will start from the beginning
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: {'#pk': 'PK',
            '#IS_COVERED': 'is_covered',
            '#ASSET_TYPE': 'asset_type',
            '#ASSET_NAME': 'asset_name',
        },
        ExpressionAttributeValues: {':pk': 'TENANT#' + TENANT_ID,
            ':is_covered': false,
            ':asset_type': REPO_ASSET_TYPE,
            ':asset_name': DOT_JIT_ASSET_NAME,
        },
    };

    const queryCommand = new QueryCommand(params);

    return await ddb.send(queryCommand);

};


const transformUp = async ({ddb, isDryRun}) => {
    const date = new Date();
    const isoDate = date.toISOString();
    const modified_at = isoDate.slice(0, isoDate.length - 1) + '000';

    const changeItemToDeactivated = (item) => {
        return {
            ...item,
            modified_at: modified_at,
            is_covered: false,
        };
    };

    return transformedFilteredItems(ddb, changeItemToDeactivated, isDryRun);
};

const transformedFilteredItems = async (ddb, transformer, isDryRun) => {
    let lastEvalKey;
    let transformedItemsKeys = [];
    const chunkSize = 25;
    let scannedAllItems = false;

    while (!scannedAllItems) {
        const {Items, LastEvaluatedKey} = await getItems(ddb, lastEvalKey);
        lastEvalKey = LastEvaluatedKey;

        const updatedItems = Items.map(transformer);

        if (!isDryRun && updatedItems.length > 0) {
            for (let i = 0; i < updatedItems.length; i += chunkSize) {
                const chunk = updatedItems.slice(i, i + chunkSize)
                await utils.batchWriteItems(ddb, ASSETS_TABLE, chunk);
            }
            transformedItemsKeys = transformedItemsKeys.concat(updatedItems.map((item) => `${item.PK}-${item.SK}`));
        } else {
            console.info(updatedItems, 'Items');
            console.info(updatedItems.length, 'Items.length');
        }

        scannedAllItems = !lastEvalKey;
    }

    return {transformed: transformedItemsKeys.length};
};

module.exports = {
    transformUp,
    transformationNumber: 30,
};
