from enum import Enum
from typing import Any, Dict, List, Optional
from typing_extensions import Literal
from jit_utils.models.tags.entities import Tag

from pydantic import BaseModel

from src.lib.constants import TEAM_TAG

AssetType = Literal['repo', 'org', 'aws_account', 'gcp_account', 'azure_account', 'web', 'api']


class AssetStatus(str, Enum):
    CONNECTED = 'connected'
    FAILED = 'failed'


class CloudProviderFields(BaseModel):
    account_id: Optional[str]


class LimitedAwsAssetFields(BaseModel):
    aws_account_id: Optional[str]
    aws_stack_arn: Optional[str]
    aws_jit_role_name: Optional[str]
    aws_regions_to_scan: Optional[List[str]]


class AwsAssetFields(LimitedAwsAssetFields):
    aws_jit_role_external_id: Optional[str]


class ZapAssetFields(BaseModel):
    # All of those fields are for ZAP related assets. See explanations on ZapJitEvent
    # in https://github.com/jitsecurity/jit-event-models/blob/main/jit_events/third_party/fargate.py
    target_url: Optional[str]
    exclude_paths: Optional[List[str]]
    authentication_mode: Optional[str]
    authentication_key: Optional[str]
    authentication_value: Optional[str]
    auth_header_name: Optional[str]
    auth_header_value: Optional[str]
    login_page_url: Optional[str]
    username: Optional[str]
    username_css_selector: Optional[str]
    password: Optional[str]
    password_ref: Optional[str]
    password_css_selector: Optional[str]
    api_domain: Optional[str]


class LimitedAsset(ZapAssetFields, LimitedAwsAssetFields, CloudProviderFields):
    """
    Asset that doesn't contain all the fields of Asset to avoid sending the external_id to UI
    """
    external_id: Optional[str]
    asset_id: str
    tenant_id: str
    asset_type: AssetType
    vendor: str
    owner: str
    asset_name: str
    risk_status: Optional[str] = None
    risk_score: int = 0
    is_active: bool
    is_covered: bool = True
    is_archived: Optional[bool]
    created_at: str
    modified_at: str
    environment: Optional[str]
    is_branch_protected_by_jit: Optional[bool]
    status: Optional[AssetStatus]
    status_details: Optional[str]
    tags: List[Tag] = []
    score: int = 0

    @property
    def teams(self) -> List[str]:
        return [tag.value for tag in self.tags if tag.name == TEAM_TAG]

    def dict(self, *args: Any, **kwargs: Any) -> Dict[str, Any]:
        dict = super().dict(*args, **kwargs)
        dict["teams"] = self.teams
        return dict


class CreateAssetRequest(ZapAssetFields, AwsAssetFields, CloudProviderFields):
    external_id: Optional[str]
    asset_type: AssetType
    vendor: str
    owner: str
    asset_name: str
    is_covered: Optional[bool]
    is_archived: Optional[bool]
    environment: Optional[str]
    status: Optional[AssetStatus]
    status_details: Optional[str]
    should_trigger_event: Optional[bool] = True


class Asset(LimitedAsset, AwsAssetFields):
    pass


class AssetKeyAttributes(BaseModel):
    tenant_id: str
    asset_type: AssetType
    vendor: str
    owner: str
    asset_name: str


class AssetsKeyAttributes(BaseModel):
    asset_type: AssetType
    vendor: Optional[str]
    owner: Optional[str]
    asset_name: Optional[str]


class GetByAssetIdValidator(BaseModel):
    tenant_id: str
    asset_id: str


class UpdateAsset(ZapAssetFields, AwsAssetFields):
    asset_id: str
    risk_status: Optional[str]
    risk_score: int = 0
    new_name: Optional[str]
    is_covered: Optional[bool]
    is_archived: Optional[bool]
    environment: Optional[str]
    is_branch_protected_by_jit: Optional[bool]
    status: Optional[AssetStatus]
    status_details: Optional[str]
    tags: Optional[List[Tag]]
    score: Optional[int]
    teams: Optional[List[str]]

    class Config:
        extra = 'forbid'


class UpdateAssetRequest(ZapAssetFields, AwsAssetFields):
    risk_status: Optional[str]
    risk_score: int = 0
    new_name: Optional[str]
    is_covered: Optional[bool]
    is_archived: Optional[bool]
    environment: Optional[str]
    is_branch_protected_by_jit: Optional[bool]
    status: Optional[AssetStatus]
    status_details: Optional[str]


class AssetCount(BaseModel):
    covered: int
    not_covered: int


class CreateAssetsResponse(BaseModel):
    created_assets_count: str


class DeleteTenantData(BaseModel):
    tenant_id: str


class DeleteAssetsEvent(BaseModel):
    tenant_id: str
    asset_ids: List[str]


class CreateAssetRequestList(BaseModel):
    assets: List[CreateAssetRequest]


class CreateAssetsEvent(BaseModel):
    tenant_id: str
    assets: List[CreateAssetRequest]


class EmptyResponse(BaseModel):
    pass


class NotFoundResponse(BaseModel):
    message: str


class AssetTypeCounts(AssetCount):
    asset_type: AssetType


class UpdateAssetsForTenantEvent(BaseModel):
    tenant_id: str
    asset_ids: List[str]


class PartiallyUpdateAsset(BaseModel):
    tenant_id: str
    update_asset: UpdateAsset
