from http import HTTPStatus
from typing import List, Literal, Optional

from jit_utils.logger import logger

from jit_utils.service_discovery import get_service_url
from jit_utils.requests.requests_client import get_session, requests
from jit_utils.service_discovery.test_utils import get_test_service_url

from .constants import TENANT_HEADER
from .endpoints import (ASSET_SERVICE_GET_ALL_ASSETS, ASSET_SERVICE_GET_ASSET_BY_ID, ASSET_SERVICE_PATCH_ASSET,
                        ASSET_SERVICE_PATCH_MULTIPLE_ASSETS, ASSET_SERVICE_GET_ASSET_BY_ATTRIBUTES,
                        ASSET_SERVICE_DELETE_ASSETS, ASSET_SERVICE_GET_ASSETS_BY_ATTRIBUTES_BASE)
from .models import Asset, CreateAssetRequest, CreateAssetsResponse, UpdateAssetRequest, UpdateAsset
from .exceptions import RequestValidationException, AssetNotFoundException, UnhandledException


class AssetService:
    @staticmethod
    def _validate_response(response: requests.Response) -> requests.Response:
        """
        Validate the response from the asset service
        Parameters:
            response: The response from the asset service
        Raises:
            RequestValidationException:
                if the server returns a status code of bad request
                meaning the request is invalid
            AssetNotFoundException:
                if the server returns a status code of not found
                meaning the asset is not found
            UnhandledException:
                if the server returns a status code of an unknown status code
                meaning there is an error that is not handled by the client
        Returns:
            The original response if it passes validation
        """
        if not response.ok:
            logger.error(f"Error response from asset service: {response.text} {response.status_code}")
            if response.status_code == HTTPStatus.BAD_REQUEST:
                raise RequestValidationException(response.text)
            if response.status_code == HTTPStatus.NOT_FOUND:
                raise AssetNotFoundException(response.text)
            raise UnhandledException(response.text)
        return response

    def __init__(self, test_mode: bool = False) -> None:
        if test_mode:
            self.service = get_test_service_url("asset-service")
        else:
            self.service = get_service_url("asset-service")["service_url"]

    def get_asset(self, tenant_id: str, asset_id: str, api_token: str) -> Asset:
        """
        Get asset by asset id

        Parameters:
            tenant_id(str): the tenant id owner of the asset to be retrieved
            asset_id(str): the asset id of the asset to be retrieved
            api_token(str): the api token of the user making the request

        Returns:
            Asset: the asset object
        """
        logger.info(f"Getting asset with {asset_id=}")
        url = ASSET_SERVICE_GET_ASSET_BY_ID.format(asset_service=self.service, asset_id=asset_id)
        response = get_session().get(
            url,
            headers={"Authorization": f"Bearer {api_token}", TENANT_HEADER: tenant_id},
        )
        self._validate_response(response)

        json_data = response.json()
        return Asset(**json_data)

    def get_asset_by_attributes(
            self, tenant_id: str, asset_type: str, vendor: str, owner: str, asset_name: str, api_token: str
    ) -> Asset:
        """
        Get asset by asset attributes

        Parameters:
            tenant_id(str): the tenant id owner of the asset to be retrieved
            asset_type(str): the asset type of the asset to be retrieved
            vendor(str): the vendor of the asset to be retrieved
            owner(str): the owner of the asset to be retrieved
            asset_name(str): the asset name of the asset to be retrieved
            api_token(str): the api token of the user making the request

        Returns:
            Asset: the asset object
        """
        logger.info(f"Getting asset with {asset_type=} {vendor=}, {owner=} and {asset_name=}")
        url = ASSET_SERVICE_GET_ASSET_BY_ATTRIBUTES.format(
            asset_service=self.service,
            asset_type=asset_type,
            vendor=vendor,
            owner=owner,
            asset_name=asset_name,
        )
        response = get_session().get(url, headers={"Authorization": f"Bearer {api_token}", TENANT_HEADER: tenant_id})
        self._validate_response(response)

        json_data = response.json()
        return Asset(**json_data)

    def get_assets_by_attributes(self, tenant_id: str, api_token: str, asset_type: str, vendor: Optional[str] = None,
                                 owner: Optional[str] = None) -> List[Asset]:
        """
        Get assets by asset attributes

        Parameters:
            tenant_id(str): the tenant id owner of the assets to be retrieved
            api_token(str): the api token of the user making the request
            asset_type(str): the asset type of the assets to be retrieved
            vendor(str): the vendor of the assets to be retrieved (optional)
            owner(str): the owner of the assets to be retrieved (optional)

        Returns:
            List[Asset]: the list of asset objects
        """
        logger.info(f"Getting assets with {asset_type=} {vendor=} {owner=}")
        url = ASSET_SERVICE_GET_ASSETS_BY_ATTRIBUTES_BASE.format(
            asset_service=self.service,
            asset_type=asset_type,
        )

        if vendor and owner:
            url = f"{url}/vendor/{vendor}/owner/{owner}"
        elif vendor:
            url = f"{url}/vendor/{vendor}"

        response = get_session().get(url, headers={"Authorization": f"Bearer {api_token}", TENANT_HEADER: tenant_id})
        self._validate_response(response)

        json_data = response.json()
        return [Asset(**asset) for asset in json_data]

    def get_all_assets(self,
                       tenant_id: str,
                       api_token: str,
                       sort_by: Optional[Literal['risk_score']] = None,
                       sort_order: Optional[Literal['asc', 'desc']] = None,
                       limit: Optional[int] = None
                       ) -> List[Asset]:
        """
        Get all assets for a tenant

        Parameters:
            tenant_id(str): the tenant id owner of the assets to be retrieved
            api_token(str): the api token of the user making the request
            sort_by(str): the field to sort by (optional, can be only risk_score)
            sort_order(str): the sort order (optional, can be only asc or desc)
            limit(int): the number of assets to return (optional)

        Returns:
            List[Asset]: the list of assets
        """
        logger.info(f"Getting all assets for {tenant_id=}")
        url = ASSET_SERVICE_GET_ALL_ASSETS.format(asset_service=self.service)
        params = {
            "sort_by": sort_by,
            "sort_order": sort_order,
            "limit": limit,
        }
        existing_params = {k: v for k, v in params.items() if v is not None}
        response = get_session().get(url, headers={"Authorization": f"Bearer {api_token}", TENANT_HEADER: tenant_id},
                                     params=existing_params if existing_params else None)
        self._validate_response(response)

        json_data = response.json()
        return [Asset(**asset) for asset in json_data]

    def create_asset(self, tenant_id: str, assets: List[CreateAssetRequest], api_token: str) -> CreateAssetsResponse:
        """
        Create assets

        Parameters:
            tenant_id(str): the tenant id owner of the assets to be created
            assets(List[CreateAssetRequest]): the list of assets to be created
            api_token(str): the api token of the user making the request

        Returns:
            CreateAssetsResponse: the response object of the create assets request
        """
        logger.info(f"Creating asset with {tenant_id=} {assets=}")
        url = self.service
        response = get_session().post(
            url,
            headers={"Authorization": f"Bearer {api_token}", TENANT_HEADER: tenant_id},
            json=[asset.dict() for asset in assets]
        )
        self._validate_response(response)

        json_data = response.json()
        return CreateAssetsResponse(**json_data)

    def update_asset(self, tenant_id: str, asset_id: str, details: UpdateAssetRequest, api_token: str) -> Asset:
        """
        Update asset by asset id

        Parameters:
            tenant_id(str): the tenant id owner of the asset to be updated
            asset_id(str): the asset id of the asset to be updated
            details(UpdateAssetRequest): the details of the asset to be updated
            api_token(str): the api token of the user making the request

        Returns:
            Asset: the updated asset object
        """
        logger.info(f"Updating asset with {tenant_id=}, {asset_id=}, {details=}")
        url = ASSET_SERVICE_PATCH_ASSET.format(asset_service=self.service, asset_id=asset_id)
        response = get_session().patch(
            url,
            headers={"Authorization": f"Bearer {api_token}", TENANT_HEADER: tenant_id},
            json=details.dict()
        )
        self._validate_response(response)

        json_data = response.json()
        return Asset(**json_data)

    def update_multiple_assets(self, tenant_id: str, assets: List[UpdateAsset], api_token: str) -> List[Asset]:
        """
        Update multiple assets

        Parameters:
            tenant_id(str): the tenant id owner of the assets to be updated
            assets(List[UpdateAsset]): the list of assets to be updated
            api_token(str): the api token of the user making the request

        Returns:
            List[Asset]: the list of updated assets
        """
        logger.info(f"Updating multiple asset with {tenant_id=}, {assets=}")
        url = ASSET_SERVICE_PATCH_MULTIPLE_ASSETS.format(asset_service=self.service)
        response = get_session().post(
            url,
            headers={"Authorization": f"Bearer {api_token}", TENANT_HEADER: tenant_id},
            json=[asset.dict() for asset in assets]
        )
        self._validate_response(response)

        json_data = response.json()
        return [Asset(**asset_data) for asset_data in json_data]

    def delete_assets(self, tenant_id: str, asset_ids: List[str], api_token: str) -> int:
        """
        Delete assets by asset ids

        Parameters:
            tenant_id(str): the tenant id owner of the assets to be deleted
            asset_ids(List[str]): the list of asset ids to be deleted
            api_token(str): the api token of the user making the request

        Returns:
            int: the number of deleted assets
        """
        logger.info(f"Deleting the followings assets with {tenant_id=}, {asset_ids=}")
        url = ASSET_SERVICE_DELETE_ASSETS.format(asset_service=self.service)

        response = get_session().post(
            url,
            headers={"Authorization": f"Bearer {api_token}", TENANT_HEADER: tenant_id},
            json=asset_ids
        )
        self._validate_response(response)

        return len(asset_ids)
