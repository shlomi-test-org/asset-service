const {utils} = require('dynamo-data-transform');
const {ScanCommand} = require('@aws-sdk/lib-dynamodb');
const YAML = require('yaml')
const crypto = require("crypto");

const ASSETS_TABLE = 'Assets';
const FILES_TABLE = 'TenantFilesCache';
const JIT_ROLE_NAME = 'JitRole';
const calculateExternalId = (asset) => {
    const hash = crypto.createHash('sha256');
    hash.update(`${asset.tenant_id}${asset.owner}`);
    return hash.digest('hex');
}

const getAllFilesCacheTableItems = async (ddb) => {
    let items = []
    let lastEvalKey = undefined;
    let scannedAllItems = false;
    while (!scannedAllItems) {
        console.log(`scanning assets table with lastEvalKey: ${lastEvalKey}`);
        const params = {
            TableName: FILES_TABLE,
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
const getAwsAccountsForTenantsByAccounts = async (ddb) => {
    const items = await getAllFilesCacheTableItems(ddb);

    return items.reduce((acc, item) => {
        item.content = YAML.parse(item.content || '');
        const accounts = (item.content && item.content.aws) || [];
        const awsAccountsByAccountId = accounts.reduce((acc, awsAccount) => {
            acc[awsAccount.account_id] = awsAccount;
            return acc;
        }, {});
        const tenantId = item.PK.split('#')[1];
        return {
            ...acc,
            [tenantId]: awsAccountsByAccountId
        }
    }, {});
}

const getAssetItems = async (ddb) => {
    let items = []
    let lastEvalKey = undefined;
    let scannedAllItems = false;
    while (!scannedAllItems) {
        console.log(`scanning assets table with lastEvalKey: ${lastEvalKey}`);
        const params = {
            TableName: ASSETS_TABLE,
            ExclusiveStartKey: lastEvalKey, // if `lastEvalKey` is null, it will start from the beginning
            FilterExpression: '#vendor = :vendor AND #is_active = :is_active AND attribute_not_exists(#aws_jit_role_external_id)',
            ExpressionAttributeNames: {'#vendor': 'vendor', '#aws_jit_role_external_id': 'aws_jit_role_external_id', '#is_active': 'is_active'},
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


const transformUp = async ({ddb, isDryRun}) => {
    const awsAccountsByTenantId = await getAwsAccountsForTenantsByAccounts(ddb);
    const transformItem = (item) => {
        let regions = []
        if (item.tenant_id in awsAccountsByTenantId && item.owner in awsAccountsByTenantId[item.tenant_id]) {
            const awsAccount = awsAccountsByTenantId[item.tenant_id][item.owner];
            regions = awsAccount.regions;
        } else {
            regions = [];
        }

        return {
            ...item,
            aws_jit_role_name: JIT_ROLE_NAME,
            aws_jit_role_external_id: calculateExternalId(item),
            aws_regions_to_scan: regions,

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
    transformationNumber: 24,
};
