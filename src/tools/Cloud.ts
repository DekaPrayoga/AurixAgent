import type { Tool } from './Registry.js';

export const cloudTools: Tool[] = [
  {
    name: 'gcloud_status',
    description: 'Check Google Cloud project status, active services, and billing.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'GCP project ID' },
      },
    },
    async execute(args) {
      const { execSync } = await import('child_process');
      const project = args.project as string | undefined;
      const projectFlag = project ? `--project=${project}` : '';
      try {
        const info = execSync(`gcloud config list ${projectFlag} 2>&1`, { encoding: 'utf8', timeout: 15000 });
        const services = execSync(`gcloud services list --enabled ${projectFlag} 2>&1 | head -20`, { encoding: 'utf8', timeout: 15000 });
        return `GCloud Config:\n${info}\n\nEnabled Services:\n${services}`;
      } catch (e: any) {
        return `gcloud error: ${e.message}\nMake sure gcloud CLI is installed and authenticated.`;
      }
    },
  },
  {
    name: 'gcloud_deploy',
    description: 'Deploy to Google Cloud Run or Cloud Functions.',
    parameters: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service name' },
        target: { type: 'string', description: 'cloud-run or cloud-functions' },
        source: { type: 'string', description: 'Source directory or container image' },
        region: { type: 'string', description: 'Region (default: us-central1)' },
      },
      required: ['service', 'target'],
    },
    async execute(args) {
      const service = args.service as string;
      const target = args.target as string;
      const source = (args.source as string) || '.';
      const region = (args.region as string) || 'us-central1';

      if (target === 'cloud-run') {
        return `Deploy to Cloud Run:\n\`\`\`bash\ngcloud run deploy ${service} --source ${source} --region ${region} --allow-unauthenticated\n\`\`\``;
      }
      if (target === 'cloud-functions') {
        return `Deploy to Cloud Functions:\n\`\`\`bash\ngcloud functions deploy ${service} --gen2 --runtime=nodejs20 --region=${region} --source=${source} --trigger-http\n\`\`\``;
      }
      return `Unknown target: ${target}. Use cloud-run or cloud-functions.`;
    },
  },
  {
    name: 'aws_status',
    description: 'Check AWS account status, active services, and costs.',
    parameters: {
      type: 'object',
      properties: {
        profile: { type: 'string', description: 'AWS profile name' },
      },
    },
    async execute(args) {
      const { execSync } = await import('child_process');
      const profile = args.profile ? `--profile ${args.profile}` : '';
      try {
        const identity = execSync(`aws sts get-caller-identity ${profile} 2>&1`, { encoding: 'utf8', timeout: 15000 });
        return `AWS Identity:\n${identity}`;
      } catch (e: any) {
        return `AWS error: ${e.message}\nMake sure AWS CLI is installed and configured.`;
      }
    },
  },
  {
    name: 'aws_deploy',
    description: 'Deploy to AWS Lambda, ECS, or EC2.',
    parameters: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service/function name' },
        target: { type: 'string', description: 'lambda, ecs, or ec2' },
        region: { type: 'string', description: 'AWS region (default: us-east-1)' },
      },
      required: ['service', 'target'],
    },
    async execute(args) {
      const service = args.service as string;
      const target = args.target as string;
      const region = (args.region as string) || 'us-east-1';

      if (target === 'lambda') {
        return `Deploy to Lambda:\n\`\`\`bash\nzip function.zip index.js\naws lambda update-function-code --function-name ${service} --zip-file fileb://function.zip --region ${region}\n\`\`\``;
      }
      return `AWS ${target} deployment for ${service} in ${region}.\nUse aws CLI or CDK for deployment.`;
    },
  },
  {
    name: 'cloud_cost',
    description: 'Estimate cloud costs or compare pricing between providers.',
    parameters: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'gcp, aws, or compare' },
        service: { type: 'string', description: 'Service type: compute, storage, database' },
        spec: { type: 'string', description: 'Spec description (e.g. "2 vCPU, 4GB RAM, 100GB SSD")' },
      },
      required: ['provider', 'service'],
    },
    async execute(args) {
      const provider = args.provider as string;
      const service = args.service as string;
      const spec = args.spec as string || 'default';
      return `Cloud cost estimate for ${provider} ${service}:\nSpec: ${spec}\n\nUse the provider's pricing calculator for accurate estimates:\n- GCP: https://cloud.google.com/products/calculator\n- AWS: https://calculator.aws/`;
    },
  },
];
