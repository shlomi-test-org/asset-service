const {utils} = require('dynamo-data-transform');
const {ScanCommand} = require('@aws-sdk/lib-dynamodb');

const ASSETS_TABLE = 'Assets';

const TENANT_ID = '168d5ba8-2e13-45e0-8800-fd2b50f66cd5'; // Neuroblade Tenant ID

const NeuroBladeRemovedAssets = [
  'verilator',
  'xccela-apm-ospi-driver',
  'vlsi-versions',
  'xmc-tests',
  'vlsi',
  'vlsi-nb2',
  'vlsi-post-scripts',
  'xplan',
  'nb-qemu-test',
  'vlfh-eco',
  'xram_v2',
  'wp1_inigo',
  'xram_v0_bringup',
  'xmc-sw',
  'xiphos-flows',
  'xram-v2-research',
  'xram-integration',
  'web-evaluator',
  'utils', // New
  'nb-qemu-test', // New - DUP asset
];


const getItems = async (ddb, lastEvalKey) => {
    let neuroBladeAssetNamesObject = {};
    NeuroBladeRemovedAssets.forEach((value, index) => {
        const assetNameKey = ':asset_name' + index;
        neuroBladeAssetNamesObject[assetNameKey.toString()] = value;
    });

    const params = {
        TableName: ASSETS_TABLE,
        ExclusiveStartKey: lastEvalKey, // if `lastEvalKey` is null, it will start from the beginning
        FilterExpression:
            '#pk = :pk and asset_name IN (' +
            Object.keys(neuroBladeAssetNamesObject).toString() +
            ')',
        ExpressionAttributeNames: {'#pk': 'PK'},
        ExpressionAttributeValues: {
            ':pk': 'TENANT#' + TENANT_ID,
            ...neuroBladeAssetNamesObject,
        },
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
            transformedItemsKeys = transformedItemsKeys.concat(
                updatedItems.map((item) => `${item.PK}-${item.SK}`)
            );
        } else {
            console.info(updatedItems, 'Items');
        }

        scannedAllItems = !lastEvalKey;
    }

    return {transformed: transformedItemsKeys.length};
};

module.exports = {
    transformUp,
    transformationNumber: 3,
};
