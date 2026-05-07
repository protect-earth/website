import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import mailchimp from '@mailchimp/mailchimp_marketing';

export const prerender = false;

const audienceId = import.meta.env.MAILCHIMP_AUDIENCE_ID;
const workPartiesMergeFieldTag = 'MMERGE7';

const groupIds: Record<string, string | undefined> = {
	general: import.meta.env.MAILCHIMP_GROUP_ID_GENERAL,
	volunteer: import.meta.env.MAILCHIMP_GROUP_ID_VOLUNTEER,
};

const regionInterestIds: Record<string, string> = {
	'South West England': '8b2a4f085a',
	'South East England': 'a8f7d9b61b',
	'East of England': '68f0931a87',
	'West Midlands': 'b4d8545587',
	'East Midlands': '728073f1e7',
	'Yorkshire & The Humber': '507d1ff31e',
	'North West England': '3014d683a0',
	'North East': '5d2e34e65d',
	'North Wales': '498e864d45',
	'South West Wales': '54ee790e75',
	'Mid Wales': '7e8c207db0',
	'South East Wales': 'b6cad07b51',
	Scotland: '5c5bdc385f',
};

mailchimp.setConfig({
	apiKey: import.meta.env.MAILCHIMP_API_KEY,
	server: import.meta.env.MAILCHIMP_SERVER_PREFIX,
});

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const {
			email,
			firstName,
			lastName,
			list,
			region,
			honeyTrap,
			site,
			workParties,
			generalUpdates,
		} = body;

		// Spam protection
		if (honeyTrap) {
			return new Response(
				JSON.stringify({ success: true, message: 'Thank you for subscribing!' }),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				},
			);
		}

		// Validate required fields
		if (!email || !firstName || (!list && !site)) {
			return new Response(
				JSON.stringify({ success: false, message: 'Please fill in all required fields.' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } },
			);
		}

		const groupId = typeof list === 'string' ? groupIds[list] : undefined;
		if (!audienceId || (list && !groupId) || (generalUpdates && !groupIds.general)) {
			return new Response(JSON.stringify({ success: false, message: 'Invalid mailing list.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const mergeFields: Record<string, string> = {
			FNAME: firstName,
		};
		if (lastName) mergeFields.LNAME = lastName;
		if (workParties) mergeFields[workPartiesMergeFieldTag] = 'Yes';

		const interests: Record<string, boolean> = {};
		if (groupId) interests[groupId] = true;
		if (generalUpdates && groupIds.general) interests[groupIds.general] = true;
		const regionInterestId = region ? regionInterestIds[region] : undefined;
		if (regionInterestId) interests[regionInterestId] = true;

		const normalizedEmail = email.toLowerCase().trim();
		const subscriberHash = createHash('md5').update(normalizedEmail).digest('hex');

		const result: any = await mailchimp.lists.setListMember(audienceId, subscriberHash, {
			email_address: normalizedEmail,
			status_if_new: 'pending',
			merge_fields: mergeFields,
			...(Object.keys(interests).length > 0 ? { interests } : {}),
		});

		if (typeof site === 'string' && site.trim()) {
			await mailchimp.lists.updateListMemberTags(audienceId, subscriberHash, {
				tags: [{ name: site.trim(), status: 'active' }],
			});
		}

		const message =
			result.status === 'pending'
				? 'Please check your email to confirm your subscription.'
				: 'You are already subscribed to this list.';

		return new Response(JSON.stringify({ success: true, message }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error: any) {
		console.error('Mailchimp subscribe error:', error);

		return new Response(
			JSON.stringify({
				success: false,
				message: 'Something went wrong. Please try again later.',
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } },
		);
	}
};
