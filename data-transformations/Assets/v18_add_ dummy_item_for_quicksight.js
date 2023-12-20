const { utils } = require("dynamo-data-transform");

const ASSETS_TABLE = "Assets";

const createAsset = (ddb, isDryRun) => {
  const date = new Date();
  const isoDate = date.toISOString();
  const now = isoDate.slice(0, isoDate.length - 1) + "000";
  items = [
    {
      PK: "_dummy_item_for_quicksight",
      SK: "_dummy_item_for_quicksight",
      asset_id: "_dummy_item_for_quicksight",
      asset_name: "_dummy_item_for_quicksight",
      asset_type: "_dummy_item_for_quicksight",
      authentication: "_dummy_item_for_quicksight",
      aws_account_id: "_dummy_item_for_quicksight",
      created_at: now,
      default_branch: "_dummy_item_for_quicksight",
      environment: "_dummy_item_for_quicksight",
      external_id: 123456789,
      headers: "_dummy_item_for_quicksight",
      is_active: false,
      is_branch_protected_by_jit: false,
      is_covered: false,
      is_private: false,
      login_page_url: "_dummy_item_for_quicksight",
      login_request_body: "_dummy_item_for_quicksight",
      login_request_url: "_dummy_item_for_quicksight",
      modified_at: now,
      owner: "_dummy_item_for_quicksight",
      password: "_dummy_item_for_quicksight",
      risk_score: 0,
      risk_status: "_dummy_item_for_quicksight",
      swagger_file_paths: "_dummy_item_for_quicksight",
      target_url: "_dummy_item_for_quicksight",
      tenant_id: "_dummy_item_for_quicksight",
      url: "_dummy_item_for_quicksight",
      username: "_dummy_item_for_quicksight",
      vendor: "_dummy_item_for_quicksight",
    },
  ];
  return utils.insertItems(ddb, ASSETS_TABLE, items, isDryRun);
};

const transformUp = async ({ ddb, isDryRun }) => {
  return createAsset(ddb, isDryRun);
};

module.exports = {
  transformUp,
  transformationNumber: 18,
};
