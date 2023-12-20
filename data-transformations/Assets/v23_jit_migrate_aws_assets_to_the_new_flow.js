const {utils} = require('dynamo-data-transform');
const {QueryCommand} = require('@aws-sdk/lib-dynamodb');
const YAML = require('yaml')
const crypto = require("crypto");

const ASSETS_TABLE = 'Assets';
const FILES_TABLE = 'TenantFilesCache';

const TENANT_ID = '2c799663-2852-4038-a261-b208611f5e2b'; // Jit Prod Tenant
const JIT_ROLE_NAME = 'JitRole';
const calculateExternalId = (asset) => {
    const hash = crypto.createHash('sha256');
    hash.update(`${asset.tenant_id}${asset.owner}`);
    return hash.digest('hex');
}

const getAwsAccountsForTenantsByAccounts = async (ddb) => {
    const params = {
        TableName: FILES_TABLE,
        KeyConditionExpression: '#pk = :pk and begins_with(#sk, :sk_prefix)',
        ExpressionAttributeNames: {'#pk': 'PK', '#sk': 'SK'},
        ExpressionAttributeValues: {':pk': 'TENANT#' + TENANT_ID, ':sk_prefix': 'ENTITY#configuration_file'},

    }
    const items = await queryItems(ddb, params);

    return items.reduce((acc, item) => {
        item.content = YAML.parse(item.content);
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
const queryItems = async (ddb, params) => {
    let items = []
    let lastEvalKey = undefined

    let scannedAllItems = false;

    while (!scannedAllItems) {
        const queryCommand = new QueryCommand({...params, ExclusiveStartKey: lastEvalKey});
        console.log('Querying items with params: ', queryCommand.input);
        const {Items, LastEvaluatedKey} = await ddb.send(queryCommand);
        lastEvalKey = LastEvaluatedKey;
        scannedAllItems = !lastEvalKey;
        items = items.concat(Items);
    }
    return items;
};

const getAssetItems = async (ddb) => {
    const params = {
        TableName: ASSETS_TABLE,
        KeyConditionExpression: '#pk = :pk',
        FilterExpression: '#vendor = :vendor and #is_active = :is_active',
        ExpressionAttributeNames: {'#pk': 'PK', '#vendor': 'vendor', '#is_active': 'is_active'},
        ExpressionAttributeValues: {':pk': 'TENANT#' + TENANT_ID, ':vendor': 'aws', ':is_active': true},
    };
    return await queryItems(ddb, params);
}


const transformUp = async ({ddb, isDryRun}) => {
    const awsAccountsByTenantId = await getAwsAccountsForTenantsByAccounts(ddb);
    const transformItem = (item) => {
        let regions = [];
        const awsAccount = awsAccountsByTenantId[item.tenant_id][item.owner] || {};
        if (awsAccount) {
            regions = awsAccount.regions || [];
        } else {
            console.log(`No aws account found for tenant ${item.tenant_id} and account ${item.owner}`)
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
    transformationNumber: 23,
};
