const {
    getGithubSecretForTenant,
    getTenantGithubRepoAssets,
    getTenantsWithGithubInstallation,
    getTenantGithubInstallation,
    getTenantInactiveGithubRepoAssetByName,
} = require("../../data-transformations-utils/aws-utils");

const {
    getGithubTenantInfo,
    getGithubInstallationReposInfo,
    getGithubBranchProtectionRules,
} = require("../../data-transformations-utils/github-utils");

const {utils} = require("dynamo-data-transform");
const uuidv4 = require("uuid");

const TENANT_ID = '168d5ba8-2e13-45e0-8800-fd2b50f66cd5'; // Neuroblade Tenant ID

const ASSETS_TABLE = 'Assets';

const generateNewGithubRepoAssetAtt = async (tenant, repo, is_active, token) => {
    const uuid = uuidv4.v4();

    const branchProtectionRules = await getGithubBranchProtectionRules(
        repo.owner,
        repo.name,
        repo.default_branch,
        token
    );
    const isProtectedByJit = !!(branchProtectionRules && branchProtectionRules.includes("Jit Security"));

    return {
        PK: `TENANT#${tenant.tenant_id}`,
        SK: `ASSET#${uuid}`,
        asset_id: `${uuid}`,
        asset_name: repo.name,
        asset_type: 'repo',
        external_id: repo.id,
        GSI1PK: `TYPE#repo#VENDOR#github#OWNER#${tenant.owner}#NAME#${repo.name}`,
        GSI3SK: 0,
        LSI1SK: 0,
        LSI2SK: 'RISK_STATUS#none',
        owner: tenant.owner,
        tenant_id: tenant.tenant_id,
        vendor: 'github',
        ...generateGithubRepoAssetIsActiveAtt(tenant.tenant_id, is_active),
        is_branch_protected_by_jit: isProtectedByJit,
    };
}

const getInactiveGithubRepoAssetByName = async (ddb, tenant, asset_name) => {
    const {Items: assets, LastEvaluatedKey} = await getTenantInactiveGithubRepoAssetByName(ddb, tenant, asset_name);
    console.log(`*** Got ${assets.length} inactive github repo assets by name ${asset_name}`);

    const asset = assets.length > 0 ? assets[0] : null;
    return asset;
};

const generateGithubRepoAssetIsActiveAtt = (tenant_id, is_active) => {
    return {
        is_active: is_active,
        GSI1SK: `TENANT#${tenant_id}#ACTIVE#${is_active}`,
        GSI2PK: `TENANT#${tenant_id}#ACTIVE#${is_active}`,
        GSI2SK: `TENANT#${tenant_id}#ACTIVE#${is_active}`,
        GSI3PK: `TENANT#${tenant_id}#ACTIVE#${is_active}`,
    }
};

const enrichAssetWithGithubInfo = async (ddb, asset, repos, tenant, token) => {
    let updatedAsset = null;
    const modifiedAt = new Date().toISOString().slice(0, -1) + "000";
    let repo = null;

    if (repos) {
        // in case of 2 repos with the same name, we are fetching only the active one
        repo = repos.length > 1 ? repos.find(obj => {
            return !obj.archived
        }) : repos[0];
    }

    // CASE #1 - name is in both Github and db
    if (asset && repo) {
        // console.log(`*** Repo ${repo.name} is in both Github and db`);
        updatedAsset = {
            ...asset,
            modified_at: modifiedAt,
            external_id: repo.id,
        };
    } else {
        console.log(`*** Repo ${asset ? asset.asset_name : repo.name} is out of sync`);

        // CASE #2 - name is in db but not in Github - set is_active=false
        if (asset && !repo) {
            console.log(`*** Repo ${asset.asset_name} is in db but not in Github - set is_active=false`);
            updatedAsset = {
                ...asset,
                ...generateGithubRepoAssetIsActiveAtt(tenant.tenant_id, false),
                modified_at: modifiedAt,
            };
        }

        // CASE #3 - name is in Github but not in db - create/update asset with is_active=true
        else if (!asset && repo) {
            // search if a matching inactive asset exist
            asset = await getInactiveGithubRepoAssetByName(ddb, tenant, repo.name)

            if (asset) {
                console.log(`*** Repo ${repo.name} is in Github but inactive in db - set is_active=true`);
                updatedAsset = {
                    ...asset,
                    ...generateGithubRepoAssetIsActiveAtt(tenant.tenant_id, true),
                    modified_at: modifiedAt,
                    external_id: repo.id,
                };
            } else {
                console.log(`*** Repo ${repo.name} is in Github but not in db - creating new asset`);
                const uuid = uuidv4.v4();
                updatedAsset = {
                    ...await generateNewGithubRepoAssetAtt(tenant, repo, true, token),
                    modified_at: modifiedAt,
                    created_at: modifiedAt,
                };
            }
        }
    }

    return updatedAsset;
};

const getTenantGithubReposMap = async (tenant) => {
    // get repos from Github
    let {token, repos} = await getTenantGithubRepos(tenant)
    console.log(`*** Got ${repos.length} repositories fron Github`);
    if (repos.length < 1) {
        // print error if no repos were found
        return []
    }

    const reposMapByName = repos.reduce(function (map, obj) {
        // console.log(`*** obj.name: ${obj.name}`);
        // console.log(`*** obj.archived: ${obj.archived}`);
        map[obj.name] = [...map[obj.name] ?? [], obj]
        return map;
    }, {});

    return {reposMapByName, token};
};

const getTenantGithubRepoAssetsMap = async (ddb, tenant) => {
    // get active github repos assets from db
    const assets = await getTenantGithubRepoAssets(ddb, tenant);
    console.log(`*** Got ${assets.length} github repo assets from db`);

    if (assets.length < 1) {
        return []
    }

    // map assets list to map by name
    const assetsMapByName = assets.reduce(function (map, obj) {
        map[obj.asset_name] = obj;
        return map;
    }, {});

    return assetsMapByName;
};

const getTenant = async (ddb, tenant_id) => {
    const {Items: tenants, LastEvaluatedKey} = await getTenantGithubInstallation(ddb, tenant_id);
    console.log(`*** Got ${tenants.length} tenants`);

    const tenant = tenants.length > 0 ? tenants[0] : null;
    return tenant;
};

const getTenantGithubRepos = async (tenant) => {
    // get github secret
    const githubSecret = await getGithubSecretForTenant(tenant.app_id);
    if (!githubSecret) {
        return [];
    }

    // create installation access token
    const tenantInfoResponse = await getGithubTenantInfo(githubSecret, tenant);
    if (!tenantInfoResponse) {
        return [];
    }

    // get github installation repos
    const response = await getGithubInstallationReposInfo(tenantInfoResponse.token, tenant);
    if (!response) {
        return [];
    }

    return {token: tenantInfoResponse.token, repos: response.repositories}
};

/**
 * @param {DynamoDBDocumentClient} ddb - dynamo db client of @aws-sdk https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb
 * @param {boolean} isDryRun
 * @returns the number of transformed items { transformed: number }
 *
 */
const transformUp = async ({ddb, isDryRun}) => {
    // get tenant
    // const tenant = await getTenant(ddb, TENANT_ID)
    // if (!tenant) {
    //     return [];
    // }
    //
    // // get active github repo assets from db
    // const assetsMapByName = await getTenantGithubRepoAssetsMap(ddb, tenant);
    //
    // // get repos from Github
    // const {reposMapByName, token} = await getTenantGithubReposMap(tenant);
    //
    // // create a combined names set
    // const combinedNamesSet = new Set([...Object.keys(assetsMapByName), ...Object.keys(reposMapByName)]);
    //
    // // compare asset and repo by name
    // const assetsToUpdate = [];
    // for (const name of combinedNamesSet) {
    //     const asset = assetsMapByName[name] ?? null;
    //     const repos = reposMapByName[name] ?? null;
    //     updatedAsset = await enrichAssetWithGithubInfo(ddb, asset, repos, tenant, token)
    //
    //     if (updatedAsset) {
    //         assetsToUpdate.push(updatedAsset);
    //     }
    // }
    // console.log(`*** Got ${assetsToUpdate.length} assets to update`);
    //
    // // update assets in db
    // await utils.insertItems(ddb, ASSETS_TABLE, assetsToUpdate, isDryRun);
    //
    // return {transformed: assetsToUpdate.length};
};

module.exports = {
    transformUp,
    transformationNumber: 19,
};

