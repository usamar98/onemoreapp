# Quick Publish

Open **Dashboard → Quick Publish**, or open a project's details and choose **Quick Publish**. The workflow saves an upload privately, shows publishing checks and a preview, then lets an Owner explicitly publish a project page or deploy a supported static website.

## Supported files

| Upload           | Limit                                         | Result                                                                  |
| ---------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| UTF-8 HTML / HTM | 20 MB                                         | Sanitized source ZIP, static build, inert private layout preview        |
| ZIP              | 20 MB compressed, 50 MB expanded, 2,000 files | Sanitized source ZIP; static build when a supported `index.html` exists |
| PDF              | 10 MB                                         | Private document; optional public viewing/download                      |
| PNG, JPEG, WebP  | 5 MB                                          | Private image; optional project-page screenshot                         |

A ZIP with a root `package.json` is treated as source unless it includes an exported `dist/`, `build/`, `out/`, or `public/` directory with `index.html`. Source files and deployable output remain separate. Chapter does not run uploaded application code on its own server. Dynamic backends, databases, and server-rendered frameworks require another deployment workflow or a static export.

## Review and publish

1. Drop one file or use the keyboard-accessible file picker. Set the project name and description, then choose **Save & preview**. Upload progress includes a separate inspection stage. Failed uploads can be retried in the same saved project; repeating the same completed upload returns its existing stored version.
2. Review the file, missing-asset warnings, excluded files, and any configuration names. HTML previews block scripts, forms, external resources, and navigation. They demonstrate layout only; they do not verify application functionality. A large HTML file is stored but may exceed the bounded preview size.
3. Confirm the review, then select the content to share. Source downloads, PDF documents, images, and demo links have separate controls. Publishing creates the existing stable `/p/<share-id>` page. A private file preview does not grant public source access.
4. A supported static build can be deployed through the project's Owner's connected Vercel account. **Deploy website to Vercel** is a separate explicit action. Chapter checks provider status before recording a ready demo URL. Without a connection, the interface provides **Connect Vercel to deploy** and existing integration instructions.

Replacing source files or adding images/documents does not silently expose them on an existing shared project or portfolio. Public file selections stay pinned until an Owner reviews and publishes the updated selection. **Make page private** stops new Chapter page/file access; it does not stop an independently hosted Vercel website. Already issued private cloud file URLs expire within 60 seconds.

## Storage, permissions, and recovery

The feature uses the existing authenticated API, owner-bound upload tickets, private storage, project roles, activity history, stored package versions, and workspace storage/project limits. Owners can publish and deploy; Editors can upload to their authorized projects; Viewers can preview and download authorized private files but cannot upload or publish. Project-scoped collaborators cannot create unrelated workspace projects.

Cloud uploads go directly to private staging storage before server-side validation, so the normal Vercel request-body limit does not block supported uploads. No new schema migration is required. See [VERCEL_SETUP.md](VERCEL_SETUP.md) for the existing database, private bucket, and encryption configuration. PDF records and Quick Publish metadata are included in complete exports and additive recovery. Recovered projects start private and disconnected from hosting controls.

Credential files are excluded from ZIPs, known credentials in recognized text files are rejected, and environment templates retain configuration names without values. PDF checks reject recognized active actions/embedded files and recognizable credentials. Automated inspection cannot find every credential, private customer detail, or sensitive image/document: the Owner must review the included content before publishing. Preview HTML is not added to AI context.

## Integration limits

Vercel is the supported hosting provider. Deployments use that connected account's billing and limits; Chapter's subscription does not include hosting charges. Files can be shared through Chapter without a hosting connection. Share pages need a publicly reachable Chapter installation for other people to access them. This feature does not add a new hosting infrastructure, password-protected links, custom domains, or QR codes.

## Verification

`npm test` covers format detection, credential rejection, bounded previews, private exports/recovery, and existing platform protections. `npm run test:e2e -- tests/e2e/quick-publish.spec.ts` exercises HTML previews, explicit source/PDF/image sharing, unpublished replacements, revocation, upload retries, source-only ZIPs, Owner/Editor/Viewer permissions, and project limits. Provider deployment tests use the existing Vercel API tests; a real deployment requires a connected account and is an explicit Owner action.
