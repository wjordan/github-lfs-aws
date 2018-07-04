const AWS = require('aws-sdk');
const s3 = new AWS.S3({useAccelerateEndpoint: true});
const octokit = require('@octokit/rest')();
const basicAuth = require('basic-auth');

const bucket = process.env.S3_BUCKET;
const expiresIn = process.env.EXPIRES_IN || 86400;
const [githubOwner, githubRepo] = process.env.REPO.split('/');

async function githubAuth(username, password) {
  octokit.authenticate({type: 'basic', username: username, password: password});
  const permissionLevel = await octokit.repos.reviewUserPermissionLevel({
    owner: githubOwner, repo: githubRepo, username: username
  });
  return ['admin', 'write'].includes(permissionLevel.data.permission);
}

exports.handler = async (event) => {
  const respond = (code, response) => {
    const respond = {
      statusCode: code,
      headers: {"Content-Type": "application/vnd.git-lfs+json" },
      body: JSON.stringify(response)
    };
    console.log("respond: " + JSON.stringify(response));
    return respond;
  };
  const error = (code, message) => respond(code, {message: message});
  if (event.path === '/') {
    return respond(200, `Github LFS server for ${githubOwner}/${githubRepo}`);
  }
  if (event.path !== '/objects/batch' || event.httpMethod !== 'POST') {
    return error(404, 'Not found');
  }

  let operation, objects;
  try {
    ({operation, objects} = JSON.parse(event.body));
  } catch (err) {
    return error(422, 'Invalid request body');
  }

  if (operation === 'upload') {
    const authorization = event.headers.Authorization;
    const credentials = basicAuth.parse(authorization);
    if (!credentials) { return error(401, 'Invalid username/password.'); }
    try {
      const authenticated = await githubAuth(credentials.name, credentials.pass);
      if (!authenticated) { return error(401, 'Github user needs write access to the repository.'); }
    } catch (err) {
      return error (401, `Invalid Github credentials: ${JSON.parse(err.message).message}`);
    }
  } else if (operation === 'download') {
  } else {
    return error(422, 'Invalid operation');
  }

  const responseObjects = objects.map(object => {
    let {oid, size} = object;
    if (!(size >= 0 && oid.match(/^[0-9a-f]{64}$/))) {
      return Object.assign({
        code: 422, message: 'Validation error'
      }, object);
    }
    const responseObject = Object.assign({
      authenticated: true,
      actions: {}
    }, object);
    const href = operation === 'download' ?
      `https://${bucket}.s3-accelerate.amazonaws.com/${oid}` :
      s3.getSignedUrl(
        'putObject',
        {
          Bucket: bucket,
          Key: oid,
          ACL: 'public-read',
          ContentType: "application/octet-stream",
          Expires: expiresIn
        }
      );
    responseObject.actions[operation] = {
      href: href,
      expires_in: expiresIn
    };
    return responseObject;
  });
  return respond(200, {
    transfer: 'basic',
    objects: responseObjects
  });
};
