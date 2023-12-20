const getInstallationsItems = async (ddb, lastEvalKey) => {
  return await ddb.query({
    TableName: 'Tenants',
    IndexName: 'GSI1',
    KeyConditionExpression: '#GSI1PK = :gsi1pk',
    FilterExpression: '#vendor = :vendor',
    ExpressionAttributeNames: {
      '#GSI1PK': 'GSI1PK',
      '#vendor': 'vendor'
    },
    ExpressionAttributeValues: {
      ':gsi1pk': 'TYPE#Installation#ACTIVE#True',
      ':vendor': 'github'
    },
    ExclusiveStartKey: lastEvalKey,
  }).promise();
};

const getExistingOrgAssetItems = async (ddb, lastEvalKey) => {
  return await ddb.scan({
    TableName: 'Assets',
    FilterExpression: '#vendor = :vendor and #asset_type = :asset_type',
    ExpressionAttributeNames: {
      '#vendor': 'vendor',
      '#asset_type': 'asset_type'
    },
    ExpressionAttributeValues: {
      ':vendor': 'github',
      ':asset_type': 'org'
    },
    ExclusiveStartKey: lastEvalKey,
  }).promise();
};

const installationItemToOrgAssetItem = (installationItem) => {
  const {v4} = require('uuid');
  const tenantId = installationItem['tenant_id'];
  const assetId = v4();
  const owner = installationItem['owner'];
  const createdTime = new Date().toISOString().split('.')[0] + '.000000';
  return {
    PK: `TENANT#${tenantId}`,
    SK: `ASSET#${assetId}`,
    LSI1SK: 0,
    created_at: createdTime,
    LSI2SK: 'RISK_STATUS#none',
    risk_status: null,
    asset_name: owner,
    GSI1SK: `TENANT#${tenantId}#ACTIVE#true`,
    vendor: 'github',
    asset_id: assetId,
    GSI3SK: 0,
    risk_score: 0,
    GSI2SK: `TENANT#${tenantId}#ACTIVE#true`,
    modified_at: createdTime,
    GSI2PK: `TENANT#${tenantId}#ACTIVE#true`,
    is_covered: true,
    GSI1PK: `TYPE#org#VENDOR#github#OWNER#${owner}#NAME#${owner}`,
    GSI3PK: `TENANT#${tenantId}#ACTIVE#true`,
    tenant_id: tenantId,
    owner: owner,
    is_active: true,
    asset_type: 'org',
  };
};

const transformUp = async (ddb, preparationData, isDryRun) => {
  let lastEvalKey;
  const existingOrgOwners = new Set();
  do {
    const { Items, LastEvaluatedKey } = await getExistingOrgAssetItems(ddb, lastEvalKey);
    const owners = Items.map(item => item['owner']);
    owners.forEach(owner => existingOrgOwners.add(owner));
    lastEvalKey = LastEvaluatedKey;
  } while (lastEvalKey);

  do {
    const {Items, LastEvaluatedKey} = await getInstallationsItems(ddb, lastEvalKey);
    lastEvalKey = LastEvaluatedKey;
    const installationsWithoutOrgAsset = Items.filter(item => !existingOrgOwners.has(item['owner']));

    const assetItemsToAdd = installationsWithoutOrgAsset.map(installationItem =>
        installationItemToOrgAssetItem(installationItem)
    );

    if (!isDryRun) {
      await save(ddb, assetItemsToAdd);
    } else {
      console.info(assetItemsToAdd, 'assetItemsToAdd');
    }
  } while (lastEvalKey);
};

const save = async (ddb, items) => {
  return await Promise.all(items.map((item) =>
    ddb.put({
      TableName: 'Assets',
      Item: item,
    }).promise()
  ));
};

module.exports = {
  transformUp,
  // transformDown,
  // prepare, // pass this function only if you need preparation data for the migration
  sequence: 2, // the migration number
};
