"""Azure Functions entry point (Python v2 model): Event Hubs trigger, identity-based connection.

App settings (infra/modules/function.bicep): ``EVENTHUB__fullyQualifiedNamespace`` and
``EVENTHUB__credential=managedidentity`` for the trigger, ``API_URL`` for the call,
``RECAP_API_SCOPE`` (``api://<matchcast-web client id>/.default``) when sign-in is on.
"""

import logging
import os

import azure.functions as func
from matchcast_recap import RecapClient, full_time_matches

app = func.FunctionApp()


def _client() -> RecapClient:
    scope = os.environ.get("RECAP_API_SCOPE")
    token = None
    if scope:
        from azure.identity import DefaultAzureCredential

        credential = DefaultAzureCredential(
            managed_identity_client_id=os.environ.get("AZURE_CLIENT_ID") or None
        )
        token = lambda: credential.get_token(scope).token  # noqa: E731
    return RecapClient(os.environ["API_URL"], token)


@app.event_hub_message_trigger(
    arg_name="events",
    event_hub_name="match-events",
    connection="EVENTHUB",
    consumer_group="$Default",
    cardinality="many",
)
def on_match_events(events: list[func.EventHubEvent]) -> None:
    matches = full_time_matches(e.get_body() for e in events)
    if not matches:
        return
    client = _client()
    for match in matches:
        result = client.request_recap(match)
        logging.info("recap requested for %s: %s", match.match_id, result)
