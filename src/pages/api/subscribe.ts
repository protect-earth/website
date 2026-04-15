import type { APIRoute } from 'astro';
import mailchimp from '@mailchimp/mailchimp_marketing';

export const prerender = false;

const audienceId = import.meta.env.MAILCHIMP_AUDIENCE_ID;

const groupIds: Record<string, string | undefined> = {
	general: import.meta.env.MAILCHIMP_GROUP_ID_GENERAL,
	volunteer: import.meta.env.MAILCHIMP_GROUP_ID_VOLUNTEER,
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

		if (list === 'volunteer' && !region) {
			return new Response(
				JSON.stringify({ success: false, message: 'Please select your region.' }),
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
		if (region) mergeFields.REGION = region;

		await mailchimp.lists.addListMember(audienceId, {
			email_address: email,
			status: 'pending',
			merge_fields: mergeFields,
			interests: { [groupId]: true },
		});

		return new Response(
			JSON.stringify({
				success: true,
				message: 'Please check your email to confirm your subscription.',
			}),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		);
	} catch (error: any) {
		// Mailchimp returns 400 with "Member Exists" when already subscribed
		if (error?.status === 400 && error?.response?.body?.title === 'Member Exists') {
			return new Response(
				JSON.stringify({
					success: true,
					message: 'You are already subscribed to this list.',
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		}

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
