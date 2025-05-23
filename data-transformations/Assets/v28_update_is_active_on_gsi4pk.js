/*
This migration will update the is_active attribute on the GSI4PK
 */

const {utils} = require('dynamo-data-transform');
const {ScanCommand} = require('@aws-sdk/lib-dynamodb');
const {
    getDynamoDbKey,
} = require('../../data-transformations-utils/common-utils');
const ASSETS_TABLE = 'Assets';


const getAssetItems = async (ddb) => {
    let items = []
    let lastEvalKey = undefined;
    let scannedAllItems = false;
    while (!scannedAllItems) {
        console.log(`scanning assets table with lastEvalKey ${JSON.stringify(lastEvalKey)}`)
        const params = {
            TableName: ASSETS_TABLE,
            FilterExpression: '#GSI1SK <> #GSI4PK',
            ExpressionAttributeNames: {
                '#GSI1SK': 'GSI1SK',
                '#GSI4PK': 'GSI4PK',
            },
            ExclusiveStartKey: lastEvalKey, // if `lastEvalKey` is null, it will start from the beginning
        }

        const scanCommand = new ScanCommand(params);
        const {Items, LastEvaluatedKey} = await ddb.send(scanCommand);
        items = items.concat(Items);
        lastEvalKey = LastEvaluatedKey;
        scannedAllItems = !lastEvalKey;
    }
    return items;
}

const transformUp = async ({ddb, isDryRun}) => {
    const items = await getAssetItems(ddb);
    console.log(`Found ${items.length} items to transform`);
    const updatedItems = items.map(transformer);
    return utils.insertItems(ddb, ASSETS_TABLE, updatedItems, isDryRun);
};

const transformer = (item) => {
    if ('tenant_id' in item) {
        const gsi4pk = getDynamoDbKey({
            tenant: item.tenant_id,
            active: item.is_active
        })
        const gsi4sk = getDynamoDbKey({
            type: item.asset_type,
            vendor: item.vendor,
            owner: item.owner,
            name: item.asset_name
        })
        return {
            ...item,
            GSI4PK: gsi4pk,
            GSI4SK: gsi4sk,
        };
    }
    return item;
}

module.exports = {
    transformUp,
    transformationNumber: 28,
};
