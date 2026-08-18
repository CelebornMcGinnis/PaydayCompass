"""
Recursively converts Python floats to Decimal in an arbitrary JSON-shaped
structure, for user-submitted data headed into a DynamoDB put_item/
update_item call. boto3's DynamoDB layer rejects raw floats outright
(TypeError: "Float types are not supported. Use Decimal types instead.")
- this exact bug class has hit multiple Lambdas in this project already
(accounts-fn, peer-notifications-fn, transactions-fn), each previously
fixed by converting known individual fields by hand. That approach
doesn't work for a structure whose shape isn't fixed in advance (e.g.
Scenarios' saved adjustments - arbitrary nested lists of dicts, each with
their own numeric fields) - this handles any shape generically.
"""
import decimal


def floats_to_decimal(obj):
    if isinstance(obj, float):
        return decimal.Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: floats_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [floats_to_decimal(v) for v in obj]
    return obj
