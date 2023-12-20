const getItems = async (ddb) => {
    let lastEvalKey;
    let items = {};
    do {
        const newItems = await ddb.scan({
            TableName: 'Assets',
            ExclusiveStartKey: lastEvalKey,
            FilterExpression: '#is_active = :is_active',
            ExpressionAttributeNames: {
                '#is_active': 'is_active'
            },
            ExpressionAttributeValues: {
                ':is_active': true
            }
        }).promise();
        newItems.Items.forEach((item) => {
            if (items[item.tenant_id] === undefined) {
                items[item.tenant_id] = [item];
            } else {
                items[item.tenant_id].push(item);
            }
        });
        lastEvalKey = newItems.LastEvaluatedKey;
    }
    while (lastEvalKey);
    return items
}

const getDuplicatedAssetsOfTenant = (items) => {
    const duplicatedAssets = [];
    const existingAssets = new Set();
    items.forEach((item) => {
        if (existingAssets.has(item.asset_name)) {
            duplicatedAssets.push(item);
            console.log(`${item.tenant_id} -- ${item.asset_name} - ${item.asset_id} duplicated`);
        } else {
            existingAssets.add(item.asset_name);
        }
    });
    return duplicatedAssets;
}

const transformUp = async (ddb, preparationData, isDryRun) => {
    const items = await getItems(ddb)
    const tenantsIDs = Object.keys(items);

    const duplicatedAssets = tenantsIDs.reduce((acc, tenantID) => {
        const tenantItems = items[tenantID];
        const duplicated = getDuplicatedAssetsOfTenant(tenantItems);
        if (duplicated.length > 0) {
            return [...acc, ...duplicated];
        }
        return acc;
    }, []);

    const updatedAssets = duplicatedAssets.map((asset) => {
        const newAsset = {
            ...asset,
            is_active: false,
            is_covered: false
        };
        return newAsset;
    });

    if (!isDryRun) {
        await save(ddb, updatedAssets)
    } else {
        console.info(duplicatedAssets.length, 'updatedItems')
    }
}

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
    // prepare, // pass this function only if you need preparation data for the migration
    sequence: 5, // the migration number
}