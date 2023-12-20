from src.lib.clients.sqs import SQSClient
from src.lib.constants import INITIAL_ITEM, JIT_PLAN, PLAN_SERVICE_INIT_PLANS_QUEUE


class PlanService:
    def __init__(self):
        self.sqs_client = SQSClient()

    def create_initial_plan(self, tenant_id: str, vendor: str) -> None:
        self.sqs_client.send_message(
            queue_name=PLAN_SERVICE_INIT_PLANS_QUEUE,
            message={
                "tenant_id": tenant_id,
                "vendor": vendor,
                "plan_slug": JIT_PLAN,
                "initial_item": INITIAL_ITEM
            }
        )
