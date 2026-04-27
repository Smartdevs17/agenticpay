#!/bin/bash
set -e

VERSION=$1
WEIGHT=$2 # The percentage of traffic (e.g., 10, 50, 100)

echo "Deploying AgenticPay Version: $VERSION"
echo "Setting Traffic Weight to: $WEIGHT%"

# this would call an API
# (e.g., AWS CLI, Kubernetes service, or Nginx reload)
# Example:
# aws elbv2 modify-listener --listener-arn $ARN --default-actions '[{"Type":"forward","ForwardConfig":{"TargetGroups":[{"TargetGroupArn":$CANARY_ARN,"Weight":'$WEIGHT'}]}}]'

echo "Traffic successfully shifted."