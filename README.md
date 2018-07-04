# GitHub LFS server on AWS

A lightweight [Git LFS](https://git-lfs.github.com/) server([less](https://aws.amazon.com/serverless/)) for public GitHub repositories that stores files in an S3 bucket, allows public downloads, and authenticates uploads based on the GitHub user's write access to the repository.

All data transfer goes between the client and S3 directly, using [transfer acceleration](https://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html) for best performance.

## Setup

### Server Deployment

The provided CloudFormation stack template contains the complete implementation, which you can deploy directly into
your own AWS account.

#### Prerequisites

* AWS profile with appropriate permissions to create a CloudFormation stack and all associated resources.
* ACM certificate matching the target subdomain.
* Route53 Hosted Zone matching the target's parent domain.

##### Deploy using the Console

[![Launch Stack](https://cdn.rawgit.com/buildkite/cloudformation-launch-stack-button-svg/master/launch-stack.svg)](https://console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=github-lfs-aws&templateURL=https://s3.amazonaws.com/wjordan-cf-templates/github-lfs-aws.yml)

Fill in the required parameters through the CloudFormation UI, and deploy the stack to your AWS account.

##### Deploy using the AWS Command Line Interface

[Configure](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html) your AWS account credentials,
then package and deploy the stack to CloudFormation using the
[`package`](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/package.html) and
[`deploy`](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/deploy/index.html) commands, providing the
rest of the required parameters as inputs:

```bash
CFN_BUCKET=[existing s3 bucket to upload Lambda function packages]
STACK_NAME=github-lfs-aws
DOMAIN=github-lfs.example.com
GITHUB_REPO=[owner]/github-lfs-aws
S3_BUCKET=[owner]-github-lfs-aws

# Derive hosted zone ('example.com') from $DOMAIN.
HOSTED_ZONE=$(echo $DOMAIN | cut -d. -f2-)

# Query the first ACM certificate with matching DomainName.
CERTIFICATE_ARN=$(aws acm list-certificates \
  --query "CertificateSummaryList[?DomainName=='*.${HOSTED_ZONE}' || DomainName == '${DOMAIN}'].CertificateArn" \
  --output text \
  | head -n1
)

OUTPUT=$(mktemp)
aws cloudformation package \
  --template-file template.yml \
  --s3-bucket $CFN_BUCKET \
  --output-template-file $OUTPUT
aws cloudformation deploy \
  --template-file $OUTPUT \
  --s3-bucket $CFN_BUCKET \
  --stack-name $STACK_NAME \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    GithubRepo=$GITHUB_REPO \
    S3Bucket=$S3_BUCKET \
    DomainName=$DOMAIN \
    HostedZoneName=$HOSTED_ZONE. \
    CertificateArn=$CERTIFICATE_ARN
```

Once your stack is deployed, you can test the endpoint directly using `curl`:

```
$ curl -w'\n' https://$DOMAIN
"Github LFS server for wjordan/github-lfs-aws"
$ curl -w'\n' -X POST https://$DOMAIN/objects/batch -d '{"operation": "download", "objects": []}'
{"transfer":"basic","objects":[]}
$ curl -w'\n' -X POST https://$DOMAIN/objects/batch -d '{"operation": "download", "objects": [{"oid": "0000000000000000000000000000000000000000000000000000000000000000",  "size": 123}]}'
{"transfer":"basic","objects":[{"authenticated":true,"actions":{"download":{"href":"https://github-lfs-aws-test.s3-accelerate.amazonaws.com/0000000000000000000000000000000000000000000000000000000000000000","expires_in":86400}},"oid":"0000000000000000000000000000000000000000000000000000000000000000","size":123}]}
$ curl -w'\n' -X POST https://$DOMAIN/objects/batch -d '{"operation": "upload", "objects": [{"oid": "0000000000000000000000000000000000000000000000000000000000000000",  "size": 123}]}' -n
{"transfer":"basic","objects":[{"authenticated":true,"actions":{"upload":{"href":"https://github-lfs-aws-test.s3-accelerate.amazonaws.com/0000000000000000000000000000000000000000000000000000000000000000?[presigned-request]","expires_in":86400}},"oid":"0000000000000000000000000000000000000000000000000000000000000000","size":123}]}
```

## Git LFS Configuration

* Install the Git LFS client according to the [Getting Started](https://git-lfs.github.com/) guide
* Configure the client to use this server with an `[lfs]` entry in a `.lfsconfig` file in the repository root:

``` git
[lfs]
    url = "https://github-lfs.example.com"
```

* Configure Git LFS to track some file patterns, e.g.:
```bash
$ git lfs track "*.png"
Tracking "*.png"
```

* To avoid manually entering credentials on every push, add GitHub credentials for the Git LFS server to `~/.netrc`:

```
machine [domain] login [username] password [password]
```

Note: If your GitHub account is protected by 2FA, use an OAuth token in place of your password.

* Push your repository to GitHub, and tracked files will be separately pushed to the LFS server:

```bash
$ git push -u origin master
Uploading LFS objects: 100% (1/1), 3.1 KB | 0 B/s, done
[...]                                                                                                                                                                         
```
