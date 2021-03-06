import json

from map_saver.models import SavedMap
from map_saver.validator import validate_metro_map

from django.test import Client
from django.test import TestCase
from django.contrib.auth.models import User, Permission
from django.core.exceptions import PermissionDenied

class ValidateMapTestCase(TestCase):

    fixtures = ['backups/2018/mmm-backup-20181110.json']

    def test_fixtures_loaded(self):
        self.assertEqual(SavedMap.objects.count(), 3983)

    def test_validator(self):

        """ Ensure that all maps already saved will pass the validation
              as written in validate_metro_map()
            That way, I'll know any changes to validate_metro_map() have
              at least been tested on a large number of real, existing maps.
        """

        saved_maps = SavedMap.objects.all()
        for saved_map in saved_maps:
            # Ensure that the maps already saved will not be malformed by the validation
            saved_map_data = dict(
                json.loads(
                    str(
                        json.loads(
                            json.dumps(
                                saved_map.mapdata.replace(" u'", "'").replace("{u'", "{'").replace("[u'", "['").replace("'", '"').replace("\\", "").strip('"').strip("'")
                            )
                        )
                    )
                )
            )

            try:
                validated_map = validate_metro_map(
                    str(
                        json.loads(
                            json.dumps(
                                saved_map.mapdata.replace(" u'", "'").replace("{u'", "{'").replace("[u'", "['").replace("'", '"').replace("\\", "").strip('"').strip("'")
                            )
                        )
                    )
                )
            except AssertionError:
                print("Failed validate_metro_map for map #{0}".format(saved_map.id))
                raise

            if saved_map_data != validated_map:
                # Characters like & get converted to &amp; as part of the validation process,
                #   so some maps will not be exactly equal off the bat.

                validated_map = dict(
                    json.loads(
                        json.dumps(
                            validated_map
                        ).replace("&amp;", '&')
                    )
                )

                self.assertEqual(saved_map_data, validated_map,
                    "saved_map.mapdata != validated version for ID: {0}:\n\n{1}\n\n{2}".format(
                        saved_map.id,
                        saved_map_data,
                        validated_map
                    )
                )


    def test_invalid_toomanylines(self):

        """ Reject a map that has too many lines (Validation #04B: <= 100 lines)
        """
        pass


class AdminPermissionsTestCase(TestCase):

    def setUp(self):

        """ Create a map and a user
        """

        saved_map = SavedMap(**{
            'urlhash': 'abc123',
            'mapdata': '{"global": {"lines": {"0896d7": {"displayName": "Blue Line"}}}, "1": {"1": {"line": "0896d7"}, "2": {"line": "0896d7"}}, "2": {"1": {"line": "0896d7"}}, "3": {"1": {"line": "0896d7"}}, "4": {"1": {"line": "0896d7"}, "2": {"line": "0896d7"}}}'
        })
        saved_map.save()

        test_user = User.objects.create_user(username='testuser1', password='1X<ISRUkw+tuK')
        test_user.save()

    def test_redirect_if_not_logged_in(self):

        """ Confirm that if you are not logged in,
            a request to one of these will result in a redirect to the login page
        """

        client = Client()

        admin_only_pages = (
            '/admin/gallery/',
            '/admin/gallery/?page=2',
            '/admin/gallery/real/',
            '/admin/gallery/real/?page=2',
            '/admin/similar/abc123',
            '/admin/direct/https://metromapmaker.com/?map=abc123',
        )

        for admin_only_page in admin_only_pages:
            response = client.get(admin_only_page)
            self.assertEqual(response.status_code, 302, admin_only_page)
            self.assertTrue(response.url.startswith('/accounts/login/'), response.url)

        response = client.post('/admin/action/', {'action': 'hide', 'map': 1})
        self.assertEqual(response.status_code, 302, admin_only_page)
        self.assertTrue(response.url.startswith('/accounts/login/'), response.url)

    def test_admin_permission_denied(self):

        """ Confirm that a logged-in user without the proper permissions
            cannot change the objects
        """

        client = Client()
        client.login(username='testuser1', password='1X<ISRUkw+tuK')

        saved_map = SavedMap.objects.get(urlhash='abc123')

        self.assertTrue(saved_map.gallery_visible)
        client.post('/admin/action/', {
            'action': 'hide',
            'map': saved_map.id
        })
        # Unchanged, because user did not have permission to hide
        saved_map.refresh_from_db()
        self.assertTrue(saved_map.gallery_visible)

        self.assertEqual(0, saved_map.tags.count())
        client.post('/admin/action/', {
            'action': 'addtag',
            'map': saved_map.id,
            'tag': 'real'
        })
        saved_map.refresh_from_db()
        self.assertEqual(0, saved_map.tags.count())

        self.assertEqual('', saved_map.name)
        client.post('/admin/action/', {
            'action': 'name',
            'map': saved_map.id,
            'name': 'London'
        })
        saved_map.refresh_from_db()
        self.assertEqual('', saved_map.name)

        self.assertEqual('', saved_map.thumbnail)
        client.post('/admin/action/', {
            'action': 'thumbnail',
            'map': saved_map.id,
            'data': 'thumbnail data'
        })
        saved_map.refresh_from_db()
        self.assertEqual('', saved_map.thumbnail)

    def test_admin_permission_granted_hide_map(self):

        """ Confirm that a logged-in user with the proper permissions
            can hide a map
        """

        permission = Permission.objects.get(name="Can set a map's gallery_visible to hidden")
        test_user = User.objects.get(username='testuser1')
        test_user.user_permissions.add(permission)
        test_user.save()

        client = Client()
        client.login(username='testuser1', password='1X<ISRUkw+tuK')

        saved_map = SavedMap.objects.get(urlhash='abc123')

        self.assertTrue(saved_map.gallery_visible)
        response = client.post('/admin/action/', {
            'action': 'hide',
            'map': saved_map.id
        })
        saved_map.refresh_from_db()
        self.assertFalse(saved_map.gallery_visible, response.context['status'])

    def test_admin_permission_granted_add_tag(self):

        """ Confirm that a logged-in user with the proper permissions
            can tag a map
        """

        permission = Permission.objects.get(name="Can change the tags associated with a map")
        test_user = User.objects.get(username='testuser1')
        test_user.user_permissions.add(permission)
        test_user.save()

        client = Client()
        client.login(username='testuser1', password='1X<ISRUkw+tuK')

        saved_map = SavedMap.objects.get(urlhash='abc123')

        self.assertEqual(0, saved_map.tags.count())
        response = client.post('/admin/action/', {
            'action': 'addtag',
            'map': saved_map.id,
            'tag': 'real'
        })
        saved_map.refresh_from_db()
        self.assertEqual(1, saved_map.tags.count())

    def test_admin_permission_granted_name_map(self):

        """ Confirm that a logged-in user with the proper permissions
            can name a map
        """

        permission = Permission.objects.get(name="Can set a map's name")
        test_user = User.objects.get(username='testuser1')
        test_user.user_permissions.add(permission)
        test_user.save()

        client = Client()
        client.login(username='testuser1', password='1X<ISRUkw+tuK')

        saved_map = SavedMap.objects.get(urlhash='abc123')

        self.assertEqual('', saved_map.name)
        client.post('/admin/action/', {
            'action': 'name',
            'map': saved_map.id,
            'name': 'London'
        })
        saved_map.refresh_from_db()
        self.assertEqual('London', saved_map.name)

    def test_admin_permission_granted_generate_thumbnail(self):

        """ Confirm that a logged-in user with the proper permissions
            can name a map
        """

        permission = Permission.objects.get(name="Can generate thumbnails for a map")
        test_user = User.objects.get(username='testuser1')
        test_user.user_permissions.add(permission)
        test_user.save()

        client = Client()
        client.login(username='testuser1', password='1X<ISRUkw+tuK')

        saved_map = SavedMap.objects.get(urlhash='abc123')

        self.assertEqual('', saved_map.thumbnail)
        client.post('/admin/action/', {
            'action': 'thumbnail',
            'map': saved_map.id,
            'data': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAACB0lEQVR4Xu3VwVGDYBgG4Y9KpJOklFiJWolaibGSYCU40YPjOBaQnYcLHNnd/4Vl3/f9/rzNbDOzzmzbzLrOHNaZ0/XBddMGltPbZX95v9b9e+0Px5uG8/IzvwIf79Y5f/zEFvj2j8jyfLns96/bPB7WeTh+f5KXp/PXXeBA4Os/+PYxEPxnYBG4fTgEbvcdgQWOG4jjWbDAcQNxPAsWOG4gjmfBAscNxPEsWOC4gTieBQscNxDHs2CB4wbieBYscNxAHM+CBY4biONZsMBxA3E8CxY4biCOZ8ECxw3E8SxY4LiBOJ4FCxw3EMezYIHjBuJ4Fixw3EAcz4IFjhuI41mwwHEDcTwLFjhuII5nwQLHDcTxLFjguIE4ngULHDcQx7NggeMG4ngWLHDcQBzPggWOG4jjWbDAcQNxPAsWOG4gjmfBAscNxPEsWOC4gTieBQscNxDHs2CB4wbieBYscNxAHM+CBY4biONZsMBxA3E8CxY4biCOZ8ECxw3E8SxY4LiBOJ4FCxw3EMezYIHjBuJ4Fixw3EAcz4IFjhuI41mwwHEDcTwLFjhuII5nwQLHDcTxLFjguIE4ngULHDcQx7NggeMG4ngWLHDcQBzPggWOG4jjWbDAcQNxPAsWOG4gjmfBAscNxPEsWOC4gTieBQscNxDHs2CB4wbieBYscNxAHM+C44E/Aa8c86hmtT50AAAAAElFTkSuQmCC'
        })
        saved_map.refresh_from_db()
        self.assertTrue(saved_map.thumbnail)
