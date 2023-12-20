const getDynamoDbKey = (keys) => {
    return Object.keys(keys).map((key) => `${key.toUpperCase()}#${keys[key].toString().toLowerCase()}`).join('#');
}

module.exports = { getDynamoDbKey };
