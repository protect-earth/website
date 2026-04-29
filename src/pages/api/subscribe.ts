import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import mailchimp from '@mailchimp/mailchimp_marketing';

export const prerender = false;

const audienceId = import.meta.env.MAILCHIMP_AUDIENCE_ID;

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
		const { email, firstName, lastName, list, region, honeyTrap } = body;

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
		if (!email || !firstName || !list) {
			return new Response(
				JSON.stringify({ success: false, message: 'Please fill in all required fields.' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } },
			);
		}

		const groupId = groupIds[list];
		if (!audienceId || !groupId) {
			return new Response(JSON.stringify({ success: false, message: 'Invalid mailing list.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const mergeFields: Record<string, string> = {
			FNAME: firstName,
		};
		if (lastName) mergeFields.LNAME = lastName;

		const interests: Record<string, boolean> = { [groupId]: true };
		const regionInterestId = region ? regionInterestIds[region] : undefined;
		if (regionInterestId) interests[regionInterestId] = true;

		const subscriberHash = createHash('md5').update(email.toLowerCase()).digest('hex');

		const result: any = await mailchimp.lists.setListMember(audienceId, subscriberHash, {
			email_address: email,
			status_if_new: 'pending',
			merge_fields: mergeFields,
			interests,
		});

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
