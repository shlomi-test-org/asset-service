import json
from typing import Any

import boto3
from jit_utils.service_discovery import get_queue_url

from jit_utils.aws_clients.config.aws_config import get_aws_config


class SQSClient:
    """
    A client for connecting to AWS SQS
    """

    def __init__(self) -> None:
        self.client = boto3.client('sqs', **get_aws_config())

    def send_message(self, queue_name: str, message: Any) -> None:
        queue_url = get_queue_url(queue_name)
        self.client.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps(message)
        )
