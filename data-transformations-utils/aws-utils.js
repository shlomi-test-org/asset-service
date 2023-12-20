const AWS = require("aws-sdk");
const { QueryCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const ASSETS_TABLE = "Assets";
const TENANT_TABLE = "Tenants";

const _getAwsSettings = () => ({
  region: process.env.AWS_REGION_NAME,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  sessionToken: process.env.AWS_SESSION_TOKEN,
});

const getGithubSecretForTenant = async (app_id) => {
  if (!app_id) {
    return null;
  }
  const secretsmanager = new AWS.SecretsManager(_getAwsSettings());
  const secretName = `github-app-certification-${app_id}`;
  try {
    console.log(`Getting secret: ${secretName}`);
    const { SecretString } = await secretsmanager
      .getSecretValue({ SecretId: secretName })
      .promise();
    return SecretString;
  } catch (e) {
    console.error("Failed to get secret", e);
    return null;
  }
};

const getTenantsWithGithubInstallation = async (
  ddb,
  batchSize,
  lastEvalKey
) => {
  let params = {
    TableName: TENANT_TABLE,
    IndexName: "GSI5",
    KeyConditionExpression: "#GSI5PK = :gsi5pk",
    FilterExpression: "#vendor = :vendor",
    ExpressionAttributeNames: {
      "#GSI5PK": "GSI5PK",
      "#vendor": "vendor",
    },
    ExpressionAttributeValues: {
      ":gsi5pk": "TYPE#Installation#ACTIVE#True",
      ":vendor": "github",
    },
  };
  if (batchSize >0) {
    params.Limit = batchSize
  }
  // add lastEvaluatedKey if it exists
  if (lastEvalKey) {
    console.log(`lastEvalKey: ${JSON.stringify(lastEvalKey)}`);
    params.ExclusiveStartKey = lastEvalKey;
  } else {
    console.log("No lastEvalKey");
  }

  let queryCommand = new QueryCommand(params);
  return await ddb.send(queryCommand);
};

const getTenantGithubRepoAssets = async (ddb, tenant) => {
  let items = [];
  let lastEvalKey;
  let moreItems = true;

  while (moreItems) {
    let params = {
      TableName: ASSETS_TABLE,
      KeyConditionExpression: "#PK = :pk",
      FilterExpression:
        "#vendor = :vendor and #owner = :owner and #asset_type = :asset_type and #is_active = :is_active",
      ExpressionAttributeNames: {
        "#PK": "PK",
        "#vendor": "vendor",
        "#owner": "owner",
        "#asset_type": "asset_type",
        "#is_active": "is_active",
      },
      ExpressionAttributeValues: {
        ":pk": `TENANT#${tenant.tenant_id}`,
        ":vendor": "github",
        ":owner": tenant.owner,
        ":asset_type": "repo",
        ":is_active": true,
      },
    };

    if (lastEvalKey) {
      params.ExclusiveStartKey = lastEvalKey;
    }

    let queryCommand = new QueryCommand(params);
    const response = await ddb.send(queryCommand);
    // console.log(`response: ${JSON.stringify(response)}`);
    const { Items, LastEvaluatedKey } = response;
    items = [...items, ...Items];
    lastEvalKey = LastEvaluatedKey;
    moreItems = lastEvalKey;
  }

  return items;
};

const getAsset = async (ddb, tenantId, assetId) => {
  const getCommand = new GetCommand({
    TableName: ASSETS_TABLE,
    Key: {
      PK: `TENANT#${tenantId}`,
      SK: `ASSET#${assetId}`,
    },
  });

  try {
    const { Item } = await ddb.send(getCommand);

    if (!Item)
      console.info(
        `No item found for tenantId: ${tenantId} and assetId: ${assetId}`
      );
    return Item;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

const getGithubRepoAssetsWithNoBranchProtection = async (ddb,tenant) => {
  let items = [];
  let lastEvalKey;
  let moreItems = true;

  while (moreItems) {
    let params = {
      TableName: ASSETS_TABLE,
      KeyConditionExpression: "#PK = :pk",
      FilterExpression:
        "#vendor = :vendor and #owner = :owner and #asset_type = :asset_type and " +
                    "(attribute_not_exists(#is_branch_protected_by_jit) or #is_branch_protected_by_jit = :null)",
      ExpressionAttributeNames: {
        "#PK": "PK",
        "#vendor": "vendor",
        "#owner": "owner",
        "#asset_type": "asset_type",
        "#is_branch_protected_by_jit" : "is_branch_protected_by_jit",
      },
      ExpressionAttributeValues: {
        ":pk": `TENANT#${tenant.tenant_id}`,
        ":vendor": "github",
        ":owner": tenant.owner,
        ":asset_type": "repo",
        ":null": null,
      },
    };

    if (lastEvalKey) {
      params.ExclusiveStartKey = lastEvalKey;
    }

    let queryCommand = new QueryCommand(params);
    const response = await ddb.send(queryCommand);
    // console.log(`response: ${JSON.stringify(response)}`);
    const { Items, LastEvaluatedKey } = response;
    items = [...items, ...Items];
    lastEvalKey = LastEvaluatedKey;
    moreItems = lastEvalKey;
  }

  return items;
};

const getTenantGithubInstallation = async (
  ddb,
  tenantId
) => {
  let params = {
    TableName: TENANT_TABLE,
    KeyConditionExpression: "#PK = :pk",
    FilterExpression: "#vendor = :vendor and #type = :type",
    ExpressionAttributeNames: {
      "#PK": "PK",
      "#vendor": "vendor",
      "#type": "type",
    },
    ExpressionAttributeValues: {
      ":pk": `TENANT#${tenantId}`,
      ":vendor": "github",
      ":type": "Installation",
    },
  };

  let queryCommand = new QueryCommand(params);
  return ddb.send(queryCommand);
};

const getTenantInactiveGithubRepoAssetByName = async (ddb, tenant, asset_name) => {
    let params = {
      TableName: ASSETS_TABLE,
      KeyConditionExpression: "#PK = :pk",
      FilterExpression:
        "#vendor = :vendor and #owner = :owner and #asset_type = :asset_type and #is_active = :is_active and #asset_name = :asset_name",
      ExpressionAttributeNames: {
        "#PK": "PK",
        "#vendor": "vendor",
        "#owner": "owner",
        "#asset_type": "asset_type",
        "#is_active": "is_active",
        "#asset_name": "asset_name"
      },
      ExpressionAttributeValues: {
        ":pk": `TENANT#${tenant.tenant_id}`,
        ":vendor": "github",
        ":owner": tenant.owner,
        ":asset_type": "repo",
        ":is_active": false,
        ":asset_name": asset_name,
      },
    };

    let queryCommand = new QueryCommand(params);
    return ddb.send(queryCommand);
};

const getTenantInactiveGithubRepoAssetsWithBadGSI3PK = async (ddb, tenant_id) => {
    let params = {
        TableName: ASSETS_TABLE,
        IndexName: "GSI3",
        KeyConditionExpression: "#GSI3PK = :gsi3pk",
        FilterExpression: "#is_active = :is_active",
        ExpressionAttributeNames: {
            "#GSI3PK": "GSI3PK",
            "#is_active": "is_active",
        },
        ExpressionAttributeValues: {
            ":gsi3pk": `TENANT#${tenant_id}#ACTIVE#true`,
            ":is_active": false,
        },
    };

    let queryCommand = new QueryCommand(params);
    return ddb.send(queryCommand);
};

module.exports = {
  getGithubSecretForTenant,
  getTenantsWithGithubInstallation,
  getTenantGithubInstallation,
  getTenantInactiveGithubRepoAssetByName,
  getTenantGithubRepoAssets,
  getAsset,
  getGithubRepoAssetsWithNoBranchProtection,
  getTenantInactiveGithubRepoAssetsWithBadGSI3PK,
};
