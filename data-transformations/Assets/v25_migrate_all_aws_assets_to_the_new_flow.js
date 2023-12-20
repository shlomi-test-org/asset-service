const {utils} = require('dynamo-data-transform');
const {ScanCommand} = require('@aws-sdk/lib-dynamodb');

const ASSETS_TABLE = 'Assets';
const TENANTS_TABLE = 'Tenants';


const getAssetItems = async (ddb) => {
    let items = []
    let lastEvalKey = undefined;
    let scannedAllItems = false;
    while (!scannedAllItems) {
        console.log(`scanning assets table with lastEvalKey: ${lastEvalKey}`);
        const params = {
            TableName: ASSETS_TABLE,
            ExclusiveStartKey: lastEvalKey, // if `lastEvalKey` is null, it will start from the beginning
            FilterExpression: '#vendor = :vendor AND #is_active = :is_active',
            ExpressionAttributeNames: {'#vendor': 'vendor', '#is_active': 'is_active'},
            ExpressionAttributeValues: {':vendor': 'aws', ':is_active': true}
        }

        const scanCommand = new ScanCommand(params);
        const {Items, LastEvaluatedKey} = await ddb.send(scanCommand);
        items = items.concat(Items);
        lastEvalKey = LastEvaluatedKey;
        scannedAllItems = !lastEvalKey;
    }
    return items;
}

const get_aws_installations = async (ddb) => {
    let items = []
    let lastEvalKey = undefined;
    let scannedAllItems = false;
    while (!scannedAllItems) {
        console.log(`scanning assets table with lastEvalKey: ${lastEvalKey}`);
        const params = {
            TableName: TENANTS_TABLE,
            ExclusiveStartKey: lastEvalKey, // if `lastEvalKey` is null, it will start from the beginning
            FilterExpression: '#vendor = :vendor AND #is_active = :is_active AND attribute_exists(#vendor_response)',
            ExpressionAttributeNames: {
                '#vendor': 'vendor',
                '#is_active': 'is_active',
                '#vendor_response': 'vendor_response'
            },
            ExpressionAttributeValues: {':vendor': 'aws', ':is_active': true}
        }

        const scanCommand = new ScanCommand(params);
        const {Items, LastEvaluatedKey} = await ddb.send(scanCommand);
        items = items.concat(Items);
        lastEvalKey = LastEvaluatedKey;
        scannedAllItems = !lastEvalKey;
    }
    return items;

}

const get_external_ids_group_by_installation_id = (aws_installations) => {
    return aws_installations.reduce((acc, installation) => {
        if (installation.vendor_response && 'integration_url' in installation.vendor_response) {
            const externalId = installation.vendor_response.integration_url.split('ExternalId=').pop();
            acc[installation.installation_id] = externalId;
        }
        return acc;
    }, {});
}


const transformUp = async ({ddb, isDryRun}) => {
    const aws_installations = await get_aws_installations(ddb);
    const external_ids_by_installation = get_external_ids_group_by_installation_id(aws_installations);
    const transformItem = (item) => {
        let externalId = null
        if (item.aws_account_id in external_ids_by_installation) {
            externalId = external_ids_by_installation[item.aws_account_id]
        } else if (item.owner in external_ids_by_installation) {
            externalId = external_ids_by_installation[item.owner]
        } else {
            console.log(`no external id for asset ${item.asset_id} with owner ${item.owner} and aws_account_id ${item.aws_account_id}`)
            return item;
        }
        if (externalId === item.aws_jit_role_external_id) {
            console.log(`no need to update asset ${item.asset_id} same external id ${externalId}`)
            return item;
        }
        console.log(`updating asset ${item.asset_id} with external id ${externalId} instead of ${item.aws_jit_role_external_id}`)
        return {
            ...item,
            aws_jit_role_external_id: externalId,

        };
    };
    return transformedFilteredItems(ddb, transformItem, isDryRun);
};

const transformedFilteredItems = async (ddb, transformer, isDryRun) => {
    const items = await getAssetItems(ddb);
    const updatedItems = items.map(transformer);
    return utils.insertItems(ddb, ASSETS_TABLE, updatedItems, isDryRun);
};

module.exports = {
    transformUp,
    transformationNumber: 25,
};
