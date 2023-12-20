// node-fetch is a mjs module
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const jwt = require('jsonwebtoken')
const fs = require('fs')

const AWS = require('aws-sdk');

// The version of nodejs in the CI is 10.x which doesn't support .flat()
const flatArray = (arr) => {
    return arr.reduce((flat, toFlatten) => {
        return flat.concat(Array.isArray(toFlatten) ? flatArray(toFlatten) : toFlatten);
    }, []);
}

const getTenants = async (ddb) => {
    let lastEvalKey;
    let tenants = []
    do {
        const {Items, LastEvaluatedKey} = await ddb.scan({
            TableName: 'Tenants',
            ExclusiveStartKey: lastEvalKey,
        }).promise();
        const relevant_items = Items.filter(item => item.PK.includes("TENANT") && item.SK.includes("VENDOR#github")
            && item.is_active)
        tenants = [...tenants, ...relevant_items]
        lastEvalKey = LastEvaluatedKey;
    } while (lastEvalKey)
    return tenants;
}

const getRepoAssetsOfTenant = async (ddb, tenant_id, owner) => {
    let lastEvalKey;
    let assets = []
    do {
        const {Items, LastEvaluatedKey} = await ddb.query({
            TableName: 'Assets',
            KeyConditionExpression: '#pk = :pk',
            FilterExpression: '#asset_type = :repo and #is_active = :is_active and #owner = :owner',
            ExclusiveStartKey: lastEvalKey,
            ExpressionAttributeNames: {
                '#pk': 'PK',
                '#asset_type': 'asset_type',
                '#is_active': 'is_active',
                '#owner': 'owner'
            },
            ExpressionAttributeValues: {
                ':pk': `TENANT#${tenant_id}`,
                ':repo': 'repo',
                ':is_active': true,
                ':owner': owner
            },
        }).promise();
        lastEvalKey = LastEvaluatedKey;
        assets = [...assets, ...Items]
    } while (lastEvalKey)
    return assets;
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

const getGithubTokenForTenant = async (ddb, tenant) => {
    const githubSecret = await getGithubSecretForTenant(ddb, tenant);
    if (!githubSecret) {
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

const getListOfRepositories = async (tenant, token) => {
    const github_api_url = `https://api.github.com/installation/repositories`
    let repos = []
    let finished = false
    let page = 1
    while (!finished) {
        const url = `${github_api_url}?page=${page}&per_page=100`
        const response = await fetch(url, {
            method: 'GET',
            params: {per_page: 100, page: page},
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
        })
        if (response.status !== 200) {
            const error_message = `Error getting list of repositories for ${tenant.tenant_id}`
            console.error(error_message)
            return
        }
        const body = await response.json()
        const githubRepos = body.repositories
        if (githubRepos.length) {
            repos = [...repos, ...githubRepos]
        }
        if (githubRepos.length < 100) {
            finished = true
        } else {
            page++
        }
    }
    return repos
}

const getAssetsToDisable = (assetsFromDB, assetsFromGithub, tenant_id) => {
    if (!assetsFromDB || !assetsFromGithub) {
        console.log("!assetsFromDB || !assetsFromGithub")
        return null
    }
    try {
        return assetsFromDB.filter(asset => {
            return !assetsFromGithub.some(githubAsset => {
                return asset.asset_name === githubAsset.name
            })
        })
    } catch (e) {
        console.log(`Error getting assets to disable for ${tenant_id}`)
        console.log(e)
    }
}

const getDataPreparationForItem = async (ddb, tenant) => {
    const assets = await getRepoAssetsOfTenant(ddb, tenant.tenant_id, tenant.owner)
    const githubToken = await getGithubTokenForTenant(ddb, tenant)
    const githubAssets = await getListOfRepositories(tenant, githubToken)
    if (githubAssets) {
        const assetsToDeactivate = getAssetsToDisable(assets, githubAssets, tenant.tenant_id)
        if (assetsToDeactivate.length > 0) {
            assetsToDeactivate.forEach(asset => {
                console.info(`${tenant.tenant_id} - Deactivating asset ${asset.asset_name}`)
            })
            return assetsToDeactivate
        }
    }
    return []
}


const prepare = async (ddb) => {
    const tenants = [...await getTenants(ddb)]
    tenants.forEach(tenant => {
        console.log(tenant.tenant_id)
    })
    console.log(`Found ${tenants.length} tenants`)
    let itemsToUpdate = await Promise.all(tenants.map(async (tenant) => getDataPreparationForItem(ddb, tenant)))
    itemsToUpdate = flatArray(itemsToUpdate)
    const preparationData = itemsToUpdate.map(item => ({
        PK: item.PK,
        SK: item.SK,
    }))
    return preparationData
}

const up = (item) => ({
    ...item,
    is_active: false,
    is_covered: false
})

const down = (item) => ({
    ...item,
    is_active: true,
    is_covered: true
})

const transformUp = async (ddb, preparationData, isDryRun) => {
    const updatedItems = preparationData.map((item) => {
        return up(item)
    })

    if (!isDryRun) {
        await update(ddb, updatedItems)
    } else {
        console.info(updatedItems, 'updatedItems')
        console.info(updatedItems.length, 'updatedItems.length')
    }
}

const transformDown = async (ddb, preparationData, isDryRun) => {
    const updatedItems = preparationData.map((item) => {
        return down(item)
    })

    if (!isDryRun) {
        await update(ddb, updatedItems)
    } else {
        console.info(updatedItems, 'updatedItems')
        console.info(updatedItems.length, 'updatedItems.length')
    }
}


const update = async (ddb, items) => {
    return await Promise.all(items.map((item) =>
        ddb.update({
            TableName: 'Assets',
            Key: {
                PK: item.PK,
                SK: item.SK,
            },
            UpdateExpression: 'set #is_active = :is_active, #is_covered = :is_covered',
            ExpressionAttributeNames: {
                '#is_active': 'is_active',
                '#is_covered': 'is_covered',
            },
            ExpressionAttributeValues: {
                ':is_active': item.is_active,
                ':is_covered': item.is_covered,
            },
            ReturnValues: 'ALL_NEW',
        }).promise()
    ))
}

module.exports = {
    transformUp,
    transformDown,
    prepare,
    sequence: 4
}