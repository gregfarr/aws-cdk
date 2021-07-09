import * as path from 'path';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import { Duration } from '@aws-cdk/core';

// keep this import separate from other imports to reduce chance for merge conflicts with v2-main
// eslint-disable-next-line no-duplicate-imports, import/order
import { Construct } from '@aws-cdk/core';

/**
 * Blah
 */
export class ApplicationSecurityCheck extends Construct {
  public readonly preApproveLambda: lambda.Function;
  public readonly cdkDiffProject: codebuild.Project;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.preApproveLambda = new lambda.Function(this, 'CDKPipelinesAutoApprove', {
      handler: 'index.handler',
      runtime: lambda.Runtime.PYTHON_3_8,
      code: lambda.Code.fromAsset(path.resolve(__dirname, '../lambda')),
      timeout: Duration.seconds(30),
    });

    this.preApproveLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['codepipeline:GetPipelineState', 'codepipeline:PutApprovalResult'],
      resources: ['*'],
    }));

    const assemblyPath = 'assembly-$STACK_NAME-$STAGE_NAME/';
    const invokeLambda =
      'aws lambda invoke' +
      ` --function-name ${this.preApproveLambda.functionName}` +
      ' --invocation-type Event' +
      ' --payload "$payload"' +
      ' lambda.out';

    this.cdkDiffProject = new codebuild.Project(this, 'CDKSecurityCheck', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: 0.2,
        phases: {
          build: {
            commands: [
              'npm install -g aws-cdk',
              // $CODEBUILD_INITIATOR will always be Code Pipeline and in the form of:
              // "codepipeline/example-pipeline-name-Xxx"
              'payload="$(node -pe \'JSON.stringify({ "PipelineName": process.env.CODEBUILD_INITIATOR.split("/")[1], "StageName": process.env.STAGE_NAME, "ActionName": process.env.ACTION_NAME })\' )"',
              // ARN: "arn:aws:codebuild:$region:$account_id:build/$project_name:$project_execution_id$"
              'ARN=$CODEBUILD_BUILD_ARN',
              'REGION="$(node -pe \'`${process.env.ARN}`.split(":")[3]\')"',
              'ACCOUNT_ID="$(node -pe \'`${process.env.ARN}`.split(":")[4]\')"',
              'PROJECT_NAME="$(node -pe \'`${process.env.ARN}`.split(":")[5].split("/")[1]\')"',
              'PROJECT_ID="$(node -pe \'`${process.env.ARN}`.split(":")[6]\')"',
              'export LINK="$REGION.console.aws.amazon.com/codesuite/codebuild/$ACCOUNT_ID/projects/$PROJECT_NAME/build/$PROJECT_NAME:$PROJECT_ID/?region=$REGION"',
              'echo "assembly-$STACK_NAME-$STAGE_NAME/"',
              // Run invoke only if cdk diff passes (returns exit code 0)
              // 0 -> true, 1 -> false
              `(cdk diff -a "${assemblyPath}" --security-only --fail && ${invokeLambda}) || echo 'Changes detected! Requires Manual Approval'`,
            ],
          },
        },
        env: {
          'exported-variables': [
            'LINK',
          ],
        },
      }),
    });

    this.cdkDiffProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudformation:DescribeStacks', 'cloudformation:GetTemplate'],
      resources: ['*'], // this is needed to check the status the stacks when doing `cdk diff`
    }));
  }

}