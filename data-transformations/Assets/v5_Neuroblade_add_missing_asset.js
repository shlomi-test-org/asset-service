const { utils } = require('dynamo-data-transform');
const uuidv4 = require('uuid');

const ASSETS_TABLE = 'Assets';

const TENANT_ID = '168d5ba8-2e13-45e0-8800-fd2b50f66cd5'; // Neuroblade Tenant ID

const createAsset = (ddb, isDryRun) => {
  const uuid = uuidv4.v4();
  const date = new Date();
  const isoDate = date.toISOString();
  const now = isoDate.slice(0, isoDate.length - 1) + '000';
  items = [
    {
      PK: 'TENANT#168d5ba8-2e13-45e0-8800-fd2b50f66cd5',
      SK: `ASSET#${uuid}`,
      asset_id: `${uuid}`,
      asset_name: 'nb-duckdb',
      asset_type: 'repo',
      created_at: now,
      GSI1PK: 'TYPE#repo#VENDOR#github#OWNER#neuroblade#NAME#nb-duckdb',
      GSI1SK: 'TENANT#168d5ba8-2e13-45e0-8800-fd2b50f66cd5#ACTIVE#true',
      GSI2PK: 'TENANT#168d5ba8-2e13-45e0-8800-fd2b50f66cd5#ACTIVE#true',
      GSI2SK: 'TENANT#168d5ba8-2e13-45e0-8800-fd2b50f66cd5#ACTIVE#true',
      GSI3PK: 'TENANT#168d5ba8-2e13-45e0-8800-fd2b50f66cd5#ACTIVE#true',
      GSI3SK: 0,
      is_active: true,
      is_covered: false,
      LSI1SK: 0,
      LSI2SK: 'RISK_STATUS#none',
      modified_at: now,
      owner: 'Neuroblade',
      tenant_id: '168d5ba8-2e13-45e0-8800-fd2b50f66cd5',
      vendor: 'github',
    },
  ];
  return utils.insertItems(ddb, ASSETS_TABLE, items, isDryRun);
};

const transformUp = async ({ ddb, isDryRun }) => {
  return createAsset(ddb, isDryRun);
};

module.exports = {
  transformUp,
  transformationNumber: 5,
};
