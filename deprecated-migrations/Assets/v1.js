const getItems = async (ddb, lastEvalKey) => {
  return await ddb.scan({
    TableName: 'Assets',
    ExclusiveStartKey: lastEvalKey,
  }).promise();
}

const transformUp = async (ddb, preparationData, isDryRun) => {
  let lastEvalKey
  do {
    const { Items, LastEvaluatedKey } = await getItems(ddb, lastEvalKey)
    lastEvalKey = LastEvaluatedKey

    const updatedItems = Items.map((item) => {
      // The order of is_covered is important here because we keep the original item is_covered if already exists
      const updatedItem = { is_covered: true, ...item }
      return updatedItem
    })

    if (!isDryRun) {
      await save(ddb, updatedItems)
    } else {
      console.info(updatedItems, 'updatedItems')
    }
  } while (lastEvalKey)
}

const transformDown = async (ddb, isDryRun) => {
  let lastEvalKey
  do {
    const { Items, LastEvaluatedKey } = await getItems(ddb, lastEvalKey)
    lastEvalKey = LastEvaluatedKey

    const updatedItems = Items.map((item) => {
      const { is_covered, ...oldItem } = item
      return oldItem
    })

    if (!isDryRun) {
      await save(ddb, updatedItems)
    } else {
      console.info(updatedItems, 'updatedItems')
    }
  } while (lastEvalKey)
}

const save = async (ddb, items) => {
  return await Promise.all(items.map((item) =>
    ddb.put({
      TableName: 'Assets',
      Item: item,
    }).promise()
  ))
}

module.exports = {
  transformUp,
  transformDown,
  // prepare, // pass this function only if you need preparation data for the migration
  sequence: 1, // the migration number
}