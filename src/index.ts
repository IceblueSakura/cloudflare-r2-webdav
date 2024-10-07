export interface Env {
	bucket: R2Bucket;
	USERNAME: string;
	PASSWORD: string;
}

// 列出所有对象
async function* listAll(bucket: R2Bucket, prefix: string, isRecursive: boolean = false) {
	let cursor: string | undefined = undefined;
	do {
		const r2_objects = await bucket.list({
			prefix,
			delimiter: isRecursive ? undefined : '/',
			cursor,
			include: ['httpMetadata', 'customMetadata'],
		});
		yield* r2_objects.objects;
		cursor = r2_objects.truncated ? r2_objects.cursor : undefined;
	} while (cursor);
}

// 从R2对象提取Dav属性
function fromR2Object(object: R2Object | null): DavProperties {
	const now = new Date().toUTCString();
	return {
		creationdate: object?.uploaded?.toUTCString() ?? now,
		displayname: object?.httpMetadata?.contentDisposition,
		getcontentlanguage: object?.httpMetadata?.contentLanguage,
		getcontentlength: object?.size?.toString() ?? '0',
		getcontenttype: object?.httpMetadata?.contentType,
		getetag: object?.etag,
		getlastmodified: object?.uploaded?.toUTCString() ?? now,
		resourcetype: object?.customMetadata?.resourcetype ?? '<collection />',
	};
}

// 获取资源路径
function makeResourcePath(request: Request): string {
	return new URL(request.url).pathname.replace(/\/$/, '');
}

// 处理GET和HEAD请求
async function handle_get_head(request: Request, bucket: R2Bucket, isHead: boolean = false): Promise<Response> {
	const resourcePath = makeResourcePath(request);

	if (request.url.endsWith('/')) {
		let page = resourcePath ? `<a href="../">..</a><br>` : '';
		for await (const object of listAll(bucket, resourcePath)) {
			const href = `/${object.key}${object.customMetadata?.resourcetype === '<collection />' ? '/' : ''}`;
			page += `<a href="${href}">${object.httpMetadata?.contentDisposition ?? object.key}</a><br>`;
		}
		return new Response(page, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
	}

	const object = await bucket.get(resourcePath, { onlyIf: request.headers, range: request.headers });
	if (!object) return new Response('Not Found', { status: 404 });
	if (!('body' in object)) return new Response('Precondition Failed', { status: 412 });

	const { rangeOffset, rangeEnd } = calcContentRange(object);
	const contentLength = rangeEnd - rangeOffset + 1;

	return new Response(isHead ? null : object.body, {
		status: (object.range && contentLength !== object.size) ? 206 : 200,
		headers: {
			'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
			'Content-Length': contentLength.toString(),
			...(object.range ? { 'Content-Range': `bytes ${rangeOffset}-${rangeEnd}/${object.size}` } : {}),
			...(object.httpMetadata?.contentDisposition && { 'Content-Disposition': object.httpMetadata.contentDisposition }),
		},
	});
}

// 计算内容范围
function calcContentRange(object: R2ObjectBody) {
	const rangeOffset = object.range?.offset ?? 0;
	const rangeEnd = Math.min(rangeOffset + (object.range?.length ?? object.size - rangeOffset) - 1, object.size - 1);
	return { rangeOffset, rangeEnd };
}

// PUT请求处理
async function handle_put(request: Request, bucket: R2Bucket): Promise<Response> {
	const resourcePath = makeResourcePath(request);
	const body = await request.arrayBuffer();
	await bucket.put(resourcePath, body, {
		onlyIf: request.headers,
		httpMetadata: request.headers,
	});
	return new Response('', { status: 201 });
}

// DELETE请求处理
async function handle_delete(request: Request, bucket: R2Bucket): Promise<Response> {
	const resourcePath = makeResourcePath(request);
	const resource = await bucket.head(resourcePath);
	if (!resource) return new Response('Not Found', { status: 404 });
	await bucket.delete(resourcePath);
	return new Response(null, { status: 204 });
}

// MKCOL请求处理
async function handle_mkcol(request: Request, bucket: R2Bucket): Promise<Response> {
	const resourcePath = makeResourcePath(request);
	if (await bucket.head(resourcePath)) return new Response('Method Not Allowed', { status: 405 });

	await bucket.put(resourcePath, new Uint8Array(), {
		httpMetadata: request.headers,
		customMetadata: { resourcetype: '<collection />' },
	});
	return new Response('', { status: 201 });
}

// COPY请求处理
async function handle_copy(request: Request, bucket: R2Bucket): Promise<Response> {
	const sourcePath = makeResourcePath(request);
	const destinationHeader = request.headers.get('Destination');
	if (!destinationHeader) return new Response('Bad Request', { status: 400 });
	const destination = new URL(destinationHeader).pathname.replace(/\/$/, '');
	const resource = await bucket.head(sourcePath);
	if (!resource) return new Response('Not Found', { status: 404 });

	const object = await bucket.get(sourcePath);
	await bucket.put(destination, object?.body, {
		httpMetadata: object?.httpMetadata,
		customMetadata: object?.customMetadata,
	});
	return new Response('', { status: 201 });
}

// MOVE请求处理
async function handle_move(request: Request, bucket: R2Bucket): Promise<Response> {
	await handle_copy(request, bucket);
	await handle_delete(request, bucket);
	return new Response('', { status: 201 });
}
