const NeuroBladeRemovedAssets = [
  'iac',
  'nb-inigo',
  'itay',
  'liav-inigo-test',
  'wiki-test',
  'inigo2',
  'kerlite',
  'israel-inigo-test',
  'israelp-sw.so-test',
  'sungrid_wrapper',
  'diag-qemu-integration',
  'v0analyticsdemo',
  'nb-devops',
  'sub_repo',
  'liav',
  'test-qemu',
  'sdks',
  'israelp-test',
  'tomer',
  'slim-inigo-test',
  'fragmentor',
  'github-utils',
  'sw-nb02-perf-sim',
  'nvme-bridge-debug-tools',
];

const getAssetsByNames = async (ddb, lastEvalKey) => {
  neuroBladeAssetNamesObject = {};
  NeuroBladeRemovedAssets.forEach((value, index) => {
    const assetNameKey = ':asset_name' + index;
    neuroBladeAssetNamesObject[assetNameKey.toString()] = value;
  });

  PK = 'TENANT#168d5ba8-2e13-45e0-8800-fd2b50f66cd5';
  return await ddb
    .query({
      TableName: 'Assets',
      KeyConditionExpression: 'PK = :pk',
      FilterExpression:
        'asset_name IN (' +
        Object.keys(neuroBladeAssetNamesObject).toString() +
        ')',
      ExpressionAttributeValues: {
        ':pk': PK,
        ...neuroBladeAssetNamesObject,
      },
      ExclusiveStartKey: lastEvalKey,
    })
    .promise();
};

const transformUp = async (ddb, preparationData, isDryRun) => {
  let lastEvalKey;
  do {
    const { Items, LastEvaluatedKey } = await getAssetsByNames(
      ddb,
      lastEvalKey
    );
    lastEvalKey = LastEvaluatedKey;

    const updatedItems = Items.map((item) => {
      // The order of is_covered is important here because we keep the original item is_covered if already exists
      const date = new Date();
      const isoDate = date.toISOString();
      const modified_at = isoDate.slice(0, isoDate.length - 1) + '000';
      const GSI1SK = item.GSI1SK.replace('true', 'false');
      const GSI2PK = item.GSI2PK.replace('true', 'false');
      const GSI2SK = item.GSI2SK.replace('true', 'false');
      const GSI3PK = item.GSI3PK.replace('true', 'false');

      const updatedItem = {
        ...item,
        is_active: false,
        is_covered: false,
        modified_at,
        GSI1SK,
        GSI2PK,
        GSI2SK,
        GSI3PK,
      };
      return updatedItem;
    });

    if (!isDryRun) {
      await save(ddb, updatedItems);
    } else {
      console.info(updatedItems, 'updatedItems');
    }
  } while (lastEvalKey);
};

const transformDown = async (ddb, isDryRun) => {
  let lastEvalKey;
  do {
    const { Items, LastEvaluatedKey } = await getItems(ddb, lastEvalKey);
    lastEvalKey = LastEvaluatedKey;

    const updatedItems = Items.map((item) => {
      const { is_covered, ...oldItem } = item;
      return oldItem;
    });

    if (!isDryRun) {
      await save(ddb, updatedItems);
    } else {
      console.info(updatedItems, 'updatedItems');
    }
  } while (lastEvalKey);
};

const save = async (ddb, items) => {
  return await Promise.all(
    items.map((item) =>
      ddb
        .put({
          TableName: 'Assets',
          Item: item,
        })
        .promise()
    )
  );
};

module.exports = {
  transformUp,
  transformDown,
  // prepare, // pass this function only if you need preparation data for the migration
  sequence: 7, // the migration number
};
