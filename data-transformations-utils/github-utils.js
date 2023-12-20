const jwt = require("jsonwebtoken");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const _generateJwt = (app_id, private_key) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // Issued at time, 60 seconds in the past to allow for clock drift
    exp: now + 10 * 60, // JWT expiration time (10 minute maximum)
    iss: app_id, // GitHub App's identifier
  };
  return jwt.sign(payload, private_key, { algorithm: "RS256" });
};

const getGithubTenantInfo = async (githubSecret, tenant, assets = null) => {
  const jwt = _generateJwt(tenant.app_id, githubSecret);
  let data = {};

  if (assets) {
    const assetNames = assets.map((asset) => asset.asset_name);
    data = {
      repositories: assetNames,
    };
  }

  const response = await fetch(
    `https://api.github.com/app/installations/${tenant.installation_id}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify(data),
    }
  );

  const body = await response.json();

  if (response.status !== 201) {
    const errorMessage = `Error getting token for ${tenant.tenant_id} - status code: ${response.status}`;
    console.error(errorMessage);
    console.error(JSON.stringify(body));
    return null;
  }

  const { token, repositories } = body;

  return {
    token,
    repositories,
  };
};

const getGithubBranchProtectionRules = async (owner, repo, branch, token) => {

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches/${branch}/protection/required_status_checks/contexts`,
    {
      method: "GET",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );
  const body = await response.json();

  if (response.status !== 200) {
    const errorMessage = `\t\t !! No branch protection rules ${owner}/${repo}/${branch} - status code: ${response.status}(${response.statusText})` +
      `\n\t\t <<${body.message}>>`;
    console.error(errorMessage);
    return null;
  }

  return body;
};

const getGithubInstallationReposInfo = async (installationAccessToken, tenant, page, per_page) => {
  const response = await fetch(
    `https://api.github.com/installation/repositories?per_page=${per_page}&page=${page}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${installationAccessToken}`,
        Accept: "application/vnd.github+json",
      }
    }
  );

  const body = await response.json();

  if (response.status !== 200) {
    const errorMessage = `Error getting repositories for ${tenant.tenant_id} - status code: ${response.status}`;
    console.error(errorMessage);
    console.error(JSON.stringify(body));
    return null;
  }

  const { total_count, repositories } = body;

  return {
    total_count,
    repositories,
  };
};

module.exports = { getGithubTenantInfo, getGithubBranchProtectionRules, getGithubInstallationReposInfo };
