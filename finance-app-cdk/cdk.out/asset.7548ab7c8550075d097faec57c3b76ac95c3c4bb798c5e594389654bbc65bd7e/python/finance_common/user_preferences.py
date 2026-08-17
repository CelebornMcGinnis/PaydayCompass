"""
Single place to read a user's notification preferences, with a default
when no row (or no such key) exists yet. Requires USER_PREFERENCES_TABLE.
"""
import os
import boto3

_dynamodb = boto3.resource("dynamodb")


def _preferences_table():
    return _dynamodb.Table(os.environ["USER_PREFERENCES_TABLE"])


def get_preference(user_id, key, default):
    item = _preferences_table().get_item(Key={"userId": user_id}).get("Item")
    if not item or key not in item:
        return default
    return item[key]
