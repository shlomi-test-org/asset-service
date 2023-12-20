// node-fetch is a mjs module
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const AWS = require('aws-sdk');

const envName = process.env.ENV_NAME
const migrationLogsPath = path.resolve(__dirname, '..', '..', `migration-logs-${envName}`);
const dataFromGithubPath = `${migrationLogsPath}/data-from-github`;
const dataFromDBPath = `${migrationLogsPath}/data-from-db`;
const logsPath = `${migrationLogsPath}/logs`;
let dryRun = process.env.IS_DRY_RUN || false;

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
            FilterExpression: 'begins_with(#PK, :PK_prefix) AND begins_with(#SK, :SK_prefix) AND #is_active = :is_active',
            ExpressionAttributeNames: {
                '#PK': 'PK',
                '#SK': 'SK',
                '#is_active': 'is_active'
            },
            ExpressionAttributeValues: {
                ':PK_prefix': 'TENANT',
                ':SK_prefix': 'VENDOR#github',
                ':is_active': true
            }
        }).promise();
        tenants = [...tenants, ...Items]
        lastEvalKey = LastEvaluatedKey;
    } while (lastEvalKey)

    if (dryRun) {
        const dataToWrite = {
            amount: tenants.length,
            tenant_ids: tenants.map(({tenant_id}) => tenant_id),
            tenants: tenants
        }
        fs.writeFileSync(`${dataFromDBPath}/tenants.json`, JSON.stringify(dataToWrite, null, 2));
    }

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

    if (dryRun) {
        const dataToWrite = {
            amount: assets.length,
            assetsNames: assets.map((asset) => asset.asset_name),
            assets: assets
        }
        fs.writeFileSync(`${dataFromDBPath}/${tenant_id}--${owner}.json`, JSON.stringify(dataToWrite, null, 2));
    }


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
        if (dryRun) {
            fs.writeFileSync(`${logsPath}/errors.txt`, errorMessage, {flag: 'a'});
        }
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
        if (dryRun) {
            fs.writeFileSync(`${logsPath}/errors.txt`, errorMessage, {flag: 'a'});
        }
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
            const errorMessage = `Error getting list of repositories for ${tenant.tenant_id}`
            if (dryRun) {
                fs.writeFileSync(`${logsPath}/errors.txt`, errorMessage, {flag: 'a'});
            }
            console.error(errorMessage)
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

    if (dryRun) {
        const dataToWrite = {
            amount: repos.length,
            reposNames: repos.map(repo => repo.name),
            repos
        }
        fs.writeFileSync(`${dataFromGithubPath}/${tenant.tenant_id}--${tenant.owner}.json`,
            JSON.stringify(dataToWrite, null, 2));
    }
    return repos
}

const getAssetsToDisable = (assetsFromDB, assetsFromGithub, tenant_id) => {
    if (!assetsFromDB || !assetsFromGithub) {
        console.log("!assetsFromDB || !assetsFromGithub")
        return null
    }
    try {
        const assetsFromGithubNames = assetsFromGithub.map(asset => asset.name)
        const assetsToDisable = assetsFromDB.filter(asset => !assetsFromGithubNames.includes(asset.asset_name))

        const dataToWrite = {
            amount: assetsToDisable.length,
            assetsToDisableNames: assetsToDisable.map(asset => asset.asset_name),
            assetsFromGithubNames,
            assetsFromDBNames: assetsFromDB.map(asset => asset.asset_name),
            assetsToDisable
        }
        if (dryRun && assetsToDisable.length) {
            fs.writeFileSync(`${logsPath}/${tenant_id}.json`,
                JSON.stringify(dataToWrite, null, 2));
        }
        return assetsToDisable
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

// There is a build in function that does this, but only in node 14+, and we use node 10
const deleteFolderRecursive = function (directoryPath) {
    if (fs.existsSync(directoryPath)) {
        fs.readdirSync(directoryPath).forEach((file, index) => {
            const curPath = path.join(directoryPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                // recurse
                deleteFolderRecursive(curPath);
            } else {
                // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(directoryPath);
    }
};

const initLogsDirs = () => {
    deleteFolderRecursive(migrationLogsPath);
    fs.mkdirSync(migrationLogsPath);
    fs.mkdirSync(dataFromDBPath)
    fs.mkdirSync(dataFromGithubPath)
    fs.mkdirSync(logsPath)
}


const prepare = async (ddb) => {
    if (dryRun) {
        initLogsDirs()
    }
    const tenants = [...await getTenants(ddb)]
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
    is_covered: false,
})

const down = (item) => ({
    ...item,
    is_active: true,
    is_covered: true,
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
            UpdateExpression: 'set #is_active = :is_active , #is_covered = :is_covered',
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
    sequence: 6
}