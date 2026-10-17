"""Start an idle local worker and stop cleanly on SIGINT or SIGTERM."""

import argparse
import os
import signal
import time


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("local",),
        default=os.environ.get("MATCHCAST_WORKER_MODE", "local"),
        help="Only local bootstrap mode is implemented (default: local).",
    )
    args = parser.parse_args()
    # argparse validates explicit arguments, but not a string default against choices.
    if args.mode != "local":
        parser.error("MATCHCAST_WORKER_MODE must be local; cloud execution is not implemented")

    stopped = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print("MatchCast worker ready: mode=local; idle scaffold; no cloud integrations", flush=True)
    while not stopped:
        time.sleep(0.2)
    print("MatchCast worker stopped", flush=True)


if __name__ == "__main__":
    main()
