"""
Email <-> Cognito sub lookups, shared by every function that needs to
resolve a user's email for sending them something, or find a user by the
email address someone else typed in (invites, sharing, peer agreements).

Requires the USER_POOL_ID environment variable, which every function in
this project already gets via commonEnv in lib/constructs/lambdas.ts.
"""
import os
import boto3

_cognito_client = boto3.client("cognito-idp")


def lookup_email_by_sub(sub):
    """Returns the email address for a Cognito user id (sub), or None."""
    user_pool_id = os.environ.get("USER_POOL_ID")
    if not user_pool_id:
        return None
    try:
        result = _cognito_client.list_users(UserPoolId=user_pool_id, Filter=f'sub = "{sub}"')
        users = result.get("Users", [])
        if not users:
            return None
        email_attr = next((a for a in users[0]["Attributes"] if a["Name"] == "email"), None)
        return email_attr["Value"] if email_attr else None
    except Exception:
        return None


def lookup_user_id_by_email(email):
    """Returns the Cognito user id (sub) for an email address, or None."""
    user_pool_id = os.environ.get("USER_POOL_ID")
    if not user_pool_id:
        return None
    try:
        result = _cognito_client.list_users(UserPoolId=user_pool_id, Filter=f'email = "{email}"')
        users = result.get("Users", [])
        if not users:
            return None
        sub_attr = next((a for a in users[0]["Attributes"] if a["Name"] == "sub"), None)
        return sub_attr["Value"] if sub_attr else None
    except Exception:
        return None
