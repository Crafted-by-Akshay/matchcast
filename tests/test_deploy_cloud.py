"""Cloud builds (AB#47): images build in Azure Container Registry, so a deploy needs no Docker."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).parents[1]
CLOUD = ROOT / "scripts/deploy_cloud.sh"
LOCAL = ROOT / "scripts/deploy_local.sh"
APPS = (ROOT / "infra/modules/containerapps.bicep").read_text()
MAIN = (ROOT / "infra/main.bicep").read_text()


def test_cloud_deploy_builds_every_image_in_acr_without_docker():
    script = CLOUD.read_text() + LOCAL.read_text()
    assert subprocess.run(["bash", "-n", str(CLOUD)]).returncode == 0
    acr = [
        ln for ln in script.splitlines() if "az acr build" in ln and not ln.lstrip().startswith("#")
    ]
    for dockerfile in ("services/api/Dockerfile", "services/mcp/Dockerfile"):
        assert any(dockerfile in line for line in acr), dockerfile
    assert any("apps/unified" in line and "API_URL" in line for line in acr)
    assert all("--platform linux/amd64" in line for line in acr)
    # the acr path never reaches a docker command
    branch = LOCAL.read_text().split('if [ "$BUILD" = acr ]', 1)[1].split("\nelse\n", 1)[0]
    assert "docker" not in branch


def test_container_apps_pull_from_acr_with_the_managed_identity_only_when_the_image_is_there():
    for app in ("api", "web", "mcp"):
        assert f"registries: {app}Registries" in APPS, app
        assert (
            f"!empty(registryServer) && startsWith({app}Image, registryServer) ? acrPull : []"
            in APPS
        )
    assert "var acrPull = [{ server: registryServer, identity: identityId }]" in APPS


def test_registry_is_basic_and_the_identity_has_acr_pull():
    registry = (ROOT / "infra/modules/registry.bicep").read_text()
    assert "name: 'Basic'" in registry and "adminUserEnabled: false" in registry
    roles = (ROOT / "infra/modules/roles.bicep").read_text()
    assert "7f951dda-4ed3-4680-a7ca-43fe172d538d" in roles  # AcrPull
    assert "registryServer: registry.outputs.loginServer" in MAIN


def test_cloud_build_upload_leaves_local_secrets_behind():
    # az acr build uploads the context; git-ignored files such as the azd env would go with it
    for path in (".dockerignore", "apps/unified/.dockerignore"):
        ignored = (ROOT / path).read_text().split()
        for entry in (".azure", ".env", ".env.*", "*.pem", "*.key"):
            assert entry in ignored, (path, entry)


def test_cloud_deploy_retries_the_steps_a_first_run_can_trip_on():
    branch = LOCAL.read_text().split('if [ "$BUILD" = acr ]', 1)[1].split("\nelse\n", 1)[0]
    assert "retry az acr build" in branch  # Docker Hub rate limits on shared build agents
    assert branch.index("azd provision") < branch.index("az acr build")  # registry before builds
    # the switch-over provision waits for the new AcrPull assignment to propagate
    assert 'retry azd provision -e "$ENV_NAME" --no-prompt' in LOCAL.read_text()
    assert "registryName: registry.outputs.name" in MAIN
