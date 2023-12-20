from typing import List, Optional, Dict
from uuid import uuid4
from fastapi import FastAPI, Header, status, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from datetime import datetime, timedelta
from .models import Asset, CreateAssetRequest, UpdateAsset, CreateAssetsResponse

app = FastAPI(title="Asset Service")

DESC = "desc"
LOW = "LOW"
MEDIUM = "MEDIUM"
HIGH = "HIGH"


def get_date(days_before: int = 0):
    """
    We create dates to the dummy asset to fit the flow.
    For example, on create flow, the created_at and modified_at will both be the current time.
    Example two: On update flow, the modified_at will be the current time and the created_at will be a past time.
    """
    return str((datetime.utcnow() - timedelta(days=days_before)).isoformat())


def get_dummy_asset(partial_asset: Optional[Dict] = None, created_before_days=7, modified_before_days=1):
    asset_item = {
        "asset_type": "repo",
        "vendor": "github",
        "owner": "jit",
        "asset_name": "asset-service",
        "asset_domain": "jitsecurity",
        "asset_id": str(uuid4()),
        "risk_status": "LOW",
        "risk_score": 10,
        "is_active": True,
        "created_at": get_date(created_before_days),
        "modified_at": get_date(modified_before_days),
        **(partial_asset or {})  # overriding the default attribute values with the ones in partial_asset
    }
    if asset_item.get('tenant_id') is None:
        asset_item['tenant_id'] = str(uuid4())

    return Asset(**asset_item)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content=jsonable_encoder({"detail": exc.errors(), "body": exc.body}),
    )


@app.post("/",
          response_model=CreateAssetsResponse, status_code=status.HTTP_201_CREATED)
def create_asset(new_assets: List[CreateAssetRequest], tenant: Optional[str] = Header(None)):
    return CreateAssetsResponse(created_assets_count=str(len(new_assets)))


@app.get("/",
         response_model=List[Asset],
         status_code=status.HTTP_200_OK)
def get_assets_by_tenant_id(
        sort_by: str = None, sort_order: str = DESC, limit: int = 7, tenant: Optional[str] = Header(None)
):
    asset_count = min(7, limit)
    repos = ["asset-service", "tenant-service", "finding-service", "report-service", "secret-service",
             "workflow-service", "webhook-service"]
    scores = [20, 10, 30, 70, 40, 5, 90]
    statuses = ["MEDIUM", "LOW", "HIGH", "HIGH", "MEDIUM", "LOW", "HIGH"]  # Note that the statuses are arbitrary
    assets = []
    for i in range(asset_count):
        assets.append(
            get_dummy_asset(
                partial_asset={
                    "tenant_id": tenant,
                    "asset_name": repos[i],
                    "risk_score": scores[i],
                    "risk_status": statuses[i],
                    "asset_id": f"repo-{i}"
                }
            )
        )

    aws_asset = get_dummy_asset(
        partial_asset={
            "tenant_id": tenant,
            "asset_name": "staging_account",
            "asset_type": "aws_account",
            "environment": "staging",
            "vendor": "aws",
            "asset_id": "aws-1"
        }
    )
    assets.append(aws_asset)

    dot_jit_asset = get_dummy_asset(
        partial_asset={
            "tenant_id": tenant,
            "asset_name": ".jit",
            "asset_type": "repo",
            "vendor": "github",
            "asset_id": "repo-123"
        }
    )

    assets.append(dot_jit_asset)

    zap_web_asset = get_dummy_asset(
        partial_asset={
            'asset_name': 'app1',
            'asset_type': 'web',
            'target_url': 'https://target_url/openapi.json',
        }
    )

    assets.append(zap_web_asset)

    if sort_by == "risk_score":
        assets.sort(key=lambda x: x.risk_score, reverse=(sort_order == DESC))
        assets = assets[:limit]

    return assets


@app.get("/asset/{asset_id}",
         response_model=Asset,
         status_code=status.HTTP_200_OK)
def get_asset_by_id(asset_id: str, tenant: Optional[str] = Header(None)):
    return get_dummy_asset(partial_asset={"tenant_id": tenant,
                                          "asset_id": asset_id,
                                          })


@app.get("/type/{asset_type}/vendor/{vendor}/owner/{owner}/name/{asset_name}",
         response_model=Asset,
         status_code=status.HTTP_200_OK)
def get_asset_by_key_attributes(
        asset_type: str, vendor: str, owner: str, asset_name: str, tenant: Optional[str] = Header(None)
):
    return get_dummy_asset(partial_asset={"tenant_id": tenant,
                                          "asset_type": asset_type,
                                          "owner": owner,
                                          "vendor": vendor,
                                          "asset_name": asset_name
                                          })


@app.get("/type/{asset_type}",
         response_model=List[Asset],
         status_code=status.HTTP_200_OK)
@app.get("/type/{asset_type}/vendor/{vendor}",
         response_model=List[Asset],
         status_code=status.HTTP_200_OK)
@app.get("/type/{asset_type}/vendor/{vendor}/owner/{owner}",
         response_model=List[Asset],
         status_code=status.HTTP_200_OK)
def get_assets_by_key_attributes(
        asset_type: str, vendor: Optional[str] = None, owner: Optional[str] = None, tenant: Optional[str] = Header(None)
):
    return [
        get_dummy_asset(
            partial_asset={"tenant_id": tenant,
                           "asset_type": asset_type,
                           "owner": owner or "jitsecurity",
                           "vendor": vendor or "github",
                           "asset_name": 'asset-1'
                           }),
        get_dummy_asset(
            partial_asset={"tenant_id": tenant,
                           "asset_type": asset_type,
                           "owner": owner or "jitsecurity",
                           "vendor": vendor or "github",
                           "asset_name": 'asset-2'
                           })]


@app.patch("/asset/{asset_id}",
           response_model=Asset,
           status_code=status.HTTP_200_OK)
def update_asset(asset_id: str, update_request: Dict, tenant: Optional[str] = Header(None)):
    validated_update_request = UpdateAsset(**update_request, asset_id=asset_id)
    if not validated_update_request.new_name:
        del validated_update_request.new_name
    return get_dummy_asset(partial_asset={"tenant_id": tenant,
                                          "asset_id": asset_id,
                                          **validated_update_request.dict(exclude_none=True)
                                          })


@app.post(
    "/assets",
    response_model=List[Asset],
    status_code=status.HTTP_200_OK)
def update_multiple_assets(new_assets_fields: List[UpdateAsset], tenant: Optional[str] = Header(None)):
    return [get_dummy_asset(partial_asset={
        "tenant_id": tenant,
        "asset_id": asset_fields.asset_id,
        **asset_fields.dict(exclude_none=True)
    }
    ) for asset_fields in new_assets_fields]


@app.post("/delete")
def delete_asset(tenant: Optional[str] = Header(None)):
    return Response(status_code=status.HTTP_204_NO_CONTENT)
