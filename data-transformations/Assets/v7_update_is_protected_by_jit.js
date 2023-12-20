const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { utils } = require('dynamo-data-transform');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require("fs");
const jwt = require("jsonwebtoken");
const AWS = require('aws-sdk');

const ASSETS_TABLE = 'Assets';
const TENANT_TABLE = 'Tenants';
const OUR_TENANT_ID = "2c799663-2852-4038-a261-b208611f5e2b"

const transformedFilteredItems = async (ddb, readFromTable, outputTable, transformer, isDryRun) => {
    let lastEvalKey;
    let transformedItemsKeys = [];
    const LastEvaluatedKey = undefined

    // const { Items, LastEvaluatedKey } = await utils.getItems(ddb, lastEvalKey, readFromTable);
    const Items = await getSpecificTenant(ddb, OUR_TENANT_ID)
    console.log(`Got back ${Items.length} tenant records for: ${OUR_TENANT_ID}`)
    const filteredTenants = Items.filter(item => item.PK.includes("TENANT") && item.SK.includes("VENDOR#github") && item.is_active);
    console.log(`Post filtering, remained with ${filteredTenants.length} tenant records for: ${OUR_TENANT_ID}`)
    let updatedAssets = await Promise.all(filteredTenants.map(transformer(ddb)));
    let flattenedArray = updatedAssets.reduce((acc, curVal) => {
        return acc.concat(curVal)
    }, []);

    if (!isDryRun && flattenedArray.length > 0) {
        const chunkSize = 25;
        for (let i = 0; i < flattenedArray.length; i += chunkSize) {
            const chunk = flattenedArray.slice(i, i + chunkSize)
            await utils.batchWriteItems(ddb, outputTable, chunk);
        }
      transformedItemsKeys = transformedItemsKeys.concat(flattenedArray.map((item) => `${item.PK}-${item.SK}`));
    } else {
      console.info(flattenedArray, 'updatedItems');
    }

    console.log(LastEvaluatedKey, 'LastEvaluatedKey')
    return {
        transformed: transformedItemsKeys.length,
        LastEvaluatedKey: LastEvaluatedKey
    };
};

const UpdateIsCoveredByJitStatus = (ddb) => async (tenant) => {
    const date = new Date();
    const isoDate = date.toISOString();
    const modified_at = isoDate.slice(0, isoDate.length - 1) + '000';

    const allAssets = await getAssetsByTenantId(ddb, tenant.tenant_id)
    console.log(`Got back ${allAssets.length} assets records for: ${tenant.tenant_id}`)
    const relevantAssets = allAssets.filter(element => isActiveGithubRepo(element, tenant.owner));
    console.log(`Post filtering remained with ${relevantAssets.length} assets records for: ${tenant.tenant_id}`)

    let updatedAssets = []
    const token = await getGithubTokenForTenant(ddb, tenant);
    if (!token) {
        console.log("Failed to get token");
    }
    for (const asset of relevantAssets) {
        const repoInfo = await getGithubRepoInfo(asset.owner, asset.asset_name, token);
        if (!repoInfo) {
            console.log("Couldn't find repo info on github for asset id: " + asset.asset_id)
            updatedAssets.push({ ...asset, is_branch_protected_by_jit: null, modified_at: modified_at });
            continue
        }
        const branch = repoInfo.default_branch;
        const is_private = repoInfo.private;
        const external_repo_id = repoInfo.id;

        const branchProtectionRules = await getGithubBranchProtectionRules(asset.owner, asset.asset_name, branch, token);
        if (!branchProtectionRules) {
            console.log(`Couldn't get branch protection rules for: ${asset.owner}/${asset.asset_name}`)
            updatedAssets.push({ ...asset, is_branch_protected_by_jit: null, external_repo_id: external_repo_id, is_private: is_private, modified_at: modified_at });
            continue
        }
        const is_branch_protected_by_jit = branchProtectionRules.includes('Jit Security');
        const updatedAsset = { ...asset, is_branch_protected_by_jit: is_branch_protected_by_jit, external_repo_id: external_repo_id, is_private: is_private, modified_at: modified_at };
        updatedAssets.push(updatedAsset)
    }

    console.log(`Returning ${updatedAssets.length} asset records after enriching`)
    return updatedAssets
};

const getAssetsByTenantId = async (ddb, tenantId) => {
    let items = [];
    let lastEvalKey;
    let scannedAllItems = false;

    while (!scannedAllItems) {
        let params = {
            TableName: 'Assets',
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: {
                ':pk': `TENANT#${tenantId}`,
            },
            ExclusiveStartKey: lastEvalKey,
        }

        let queryCommand = new QueryCommand(params)
        const { Items, LastEvaluatedKey } = await ddb.send(queryCommand)
        items = [...items, ...Items]
        lastEvalKey = LastEvaluatedKey;
        scannedAllItems = !lastEvalKey;
    }

    return items
}

const getSpecificTenant = async (ddb, tenantId) => {
    let params = {
        TableName: 'Tenants',
        KeyConditionExpression: 'PK = :pk and begins_with(SK, :sk_prefix)',
        ExpressionAttributeValues: {
            ':pk': `TENANT#${tenantId}`,
            ':sk_prefix': 'VENDOR#github',
        },
    }

    let queryCommand = new QueryCommand(params)
    const {Items} = await ddb.send(queryCommand)
    return Items
}

const isActiveGithubRepo = (item, owner) => {
    const isGithubAsset = item.vendor === 'github';
    const isGithubRepo = item.asset_type === 'repo';
    const isActive = item.is_active === true;
    const sameOwner = item.owner === owner;
    return isGithubAsset && isGithubRepo && isActive && sameOwner;
}

const getAwsSettings = () => ({
    'region': process.env.AWS_REGION_NAME,
    'accessKeyId': process.env.AWS_ACCESS_KEY_ID,
    'secretAccessKey': process.env.AWS_SECRET_ACCESS_KEY,
    'sessionToken': process.env.AWS_SESSION_TOKEN
})

const getGithubSecretForTenant = async (ddb, tenant) => {
    const secretsmanager = new AWS.SecretsManager(getAwsSettings());
    const secretName = `github-app-certification-${tenant.app_id}`
    try {
        const {SecretString} = await secretsmanager.getSecretValue({SecretId: secretName}).promise();
        return SecretString;
    } catch (e) {
        const errorMessage = `Failed to find secret for tenant: ${tenant.tenant_id}, owner: ${tenant.owner}`;
        console.error(errorMessage);
        return null;
    }
}

const generateJwt = (app_id, private_key) => {
    const now = Math.floor(Date.now() / 1000)
    const payload = {
        "iat": now - 60,  // Issued at time, 60 seconds in the past to allow for clock drift
        "exp": now + (10 * 60),  // JWT expiration time (10 minute maximum)
        "iss": app_id,  // GitHub App's identifier
    }
    return jwt.sign(payload, private_key, {algorithm: 'RS256'})
}


const getGithubBranchProtectionRules = async (owner, repo, branch, token) => {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches/${branch}/protection/required_status_checks/contexts`, {
        method: 'GET',
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    })

    if (response.status !== 200) {
        const errorMessage = `Error github branch protection rule for ${owner}/${repo} - status code: ${response.status}`;
        const fileName = `${__dirname}/errors.txt`;
        fs.writeFileSync(fileName, errorMessage, {flag: 'a'});
        console.error(errorMessage);
        return null;
    }

    return await response.json()
}

const getGithubRepoInfo = async (owner, repo, token) => {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        method: 'GET',
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    })

    if (response.status !== 200) {
        const errorMessage = `Error getting repo info for ${owner}/${repo} - status code: ${response.status}`;
        const fileName = `${__dirname}/errors.txt`;
        fs.writeFileSync(fileName, errorMessage, {flag: 'a'});
        console.error(errorMessage);
        return null;
    }

    return await response.json()
}

const getGithubTokenForTenant = async (ddb, tenant) => {
    const githubSecret = await getGithubSecretForTenant(ddb, tenant);
    if (!githubSecret) {
        console.log('Failed to get secret')
        return null;
    }
    const jwt = generateJwt(tenant.app_id, githubSecret)
    const response = await fetch(`https://api.github.com/app/installations/${tenant.installation_id}/access_tokens`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${jwt}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    })

    if (response.status !== 201) {
        const errorMessage = `Error getting token for ${tenant.tenant_id} - status code: ${response.status}`;
        const fileName = `${__dirname}/errors.txt`;
        fs.writeFileSync(fileName, errorMessage, {flag: 'a'});
        console.error(errorMessage);
        return null;
    }
    const body = await response.json()
    return body.token

}
/**
 * @param {DynamoDBDocumentClient} ddb - dynamo db client of @aws-sdk https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb
 * @param {boolean} isDryRun
 * @returns the number of transformed items { transformed: number }
 *
 */
const transformUp = async ({ ddb, isDryRun}) => {
  return transformedFilteredItems(
      ddb,
      TENANT_TABLE,
      ASSETS_TABLE,
      UpdateIsCoveredByJitStatus,
      isDryRun,
  )
};

module.exports = {
    transformUp,
    transformationNumber: 7,
};
