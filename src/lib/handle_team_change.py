import json
import time
from http import HTTPStatus
from typing import List, Tuple, Optional
from src.lib.exceptions import DBException
from jit_utils.logger import logger
from jit_utils.models.teams.entities import TeamsChangedForRepoEvent
from jit_utils.models.asset.entities import AssetTagsChangedEvent
from jit_utils.models.tags.entities import Tag
from jit_utils.aws_clients.events import EventBridgeClient
from src.asset_service.models import Asset, UpdateAsset
from src.lib.asset_manager import AssetManager
from src.lib.constants import ASSET_SERVICE_BUS, ASSET_TAGS_CHANGED_DETAIL_TYPE, \
    DYNAMO_OPTIMISTIC_LOCKING_RETRY_COUNT, DYNAMO_OPTIMISTIC_LOCKING_RETRY_DELAY, EVENT_SOURCE, TEAM_TAG
from src.lib.exceptions import ItemNotFound


def get_related_asset(asset_manager: AssetManager, team_change_event: TeamsChangedForRepoEvent) -> Optional[Asset]:
    try:
        related_asset = asset_manager.get_exact_asset_by_attributes(
            tenant_id=team_change_event.tenant_id,
            asset_type=team_change_event.asset_type,
            vendor=team_change_event.vendor,
            owner=team_change_event.owner,
            asset_name=team_change_event.asset_name
        )
    except ItemNotFound:
        logger.info(f'No related asset for {team_change_event=}')
        return None
    return related_asset


def generate_update_asset(related_asset: Asset, tags_for_added_teams: List[Tag],
                          tags_for_removed_teams: List[Tag]) -> UpdateAsset:
    current_tags = related_asset.tags
    logger.info(f"Updating asset {related_asset.asset_id} with {tags_for_added_teams=} and {tags_for_removed_teams=}")
    current_tags.extend(tags_for_added_teams)
    current_tags = [tag for tag in current_tags if tag not in tags_for_removed_teams]
    return UpdateAsset(asset_id=related_asset.asset_id, tags=current_tags)


def update_asset_with_optimistic_locking(asset_manager: AssetManager, related_asset: Asset,
                                         update_asset: UpdateAsset,
                                         team_change_event: TeamsChangedForRepoEvent,
                                         tags_for_added_teams: List[Tag],
                                         tags_for_removed_teams: List[Tag]) -> None:
    for attempt in range(DYNAMO_OPTIMISTIC_LOCKING_RETRY_COUNT):
        try:
            asset_manager.update_asset(related_asset, update_asset)
            logger.info(f"Successfully updated asset {related_asset.asset_id}")
            break
        except DBException as e:
            if e.status == HTTPStatus.NOT_FOUND and attempt < DYNAMO_OPTIMISTIC_LOCKING_RETRY_COUNT - 1:
                logger.warning("Update failed due to conditional check, retrying...")
                time.sleep(DYNAMO_OPTIMISTIC_LOCKING_RETRY_DELAY)
                related_asset = get_related_asset(asset_manager, team_change_event)
                update_asset = generate_update_asset(related_asset, tags_for_added_teams, tags_for_removed_teams)
                logger.info(
                    f"Retrieved asset {related_asset.asset_id} for retry attempt {attempt + 1}. {related_asset=}")
            else:
                logger.exception(f"Failed to update asset after {DYNAMO_OPTIMISTIC_LOCKING_RETRY_COUNT} attempts.")
                raise


def publish_asset_change_event(related_asset_id: str,
                               tenant_id: str,
                               tags_for_added_teams: List[Tag],
                               tags_for_removed_teams: List[Tag]) -> None:
    logger.info(f"Publishing event for the changed tags for asset {related_asset_id}")
    event = AssetTagsChangedEvent(
        tenant_id=tenant_id,
        asset_id=related_asset_id,
        removed_tags=tags_for_removed_teams,
        added_tags=tags_for_added_teams
    )
    logger.info(f"Publishing event {event=}")
    events_client = EventBridgeClient()
    events_client.put_event(source=EVENT_SOURCE,
                            bus_name=ASSET_SERVICE_BUS,
                            detail_type=ASSET_TAGS_CHANGED_DETAIL_TYPE,
                            detail=json.dumps(event.dict()))
    logger.info(f"Successfully published event {event=}")


def generate_team_tags(current_tags: List[Tag], team_change_event: TeamsChangedForRepoEvent) \
        -> Tuple[List[Tag], List[Tag]]:
    """
    Generates tags for added and removed teams.

    This function receives the current_tags of an asset and the team_change_event,
    then generates two lists of tags:
    - tags_for_added_teams: list of tags for each team added, only if the tag does not already exist.
    - tags_for_removed_teams: list of tags for each team removed, only if the tag already exists.

    Args:
        current_tags (List[Tag]): The list of current tags on the asset.
        team_change_event (TeamsChangedForRepoEvent): The event triggering the team change.

    Returns:
        Tuple[List[Tag], List[Tag]]: A tuple of two lists of tags, first for the added teams and second
        for the removed teams.
    """
    tags_for_added_teams = []
    for team_name in team_change_event.team_names_added:
        tag = Tag(name=TEAM_TAG, value=team_name)
        if tag not in current_tags:
            tags_for_added_teams.append(tag)
        else:
            logger.info(f"Tag {tag=} already exists on asset, skipping")

    tags_for_removed_teams = []
    for team_name in team_change_event.team_names_removed:
        tag = Tag(name=TEAM_TAG, value=team_name)
        if tag in current_tags:
            tags_for_removed_teams.append(tag)
        else:
            logger.info(f"Tag {tag=} does not exist on asset, skipping")

    return tags_for_added_teams, tags_for_removed_teams


def handle_team_change_event_core(team_change_event: TeamsChangedForRepoEvent) -> None:
    logger.info(f"Handling team change event {team_change_event=}")
    asset_manager = AssetManager()
    related_asset = get_related_asset(asset_manager, team_change_event)
    if related_asset:
        tags_for_added_teams, tags_for_removed_teams = generate_team_tags(related_asset.tags, team_change_event)

        if tags_for_added_teams or tags_for_removed_teams:
            update_asset = generate_update_asset(related_asset, tags_for_added_teams, tags_for_removed_teams)
            update_asset_with_optimistic_locking(asset_manager, related_asset, update_asset,
                                                 team_change_event, tags_for_added_teams, tags_for_removed_teams)
            publish_asset_change_event(related_asset.asset_id, team_change_event.tenant_id,
                                       tags_for_added_teams,
                                       tags_for_removed_teams)
        else:
            logger.info(f"No tags to add or remove for {team_change_event=}. Skipping.")
    else:
        logger.info(f"No related asset found for {team_change_event=} finishing gracefully")
        return
