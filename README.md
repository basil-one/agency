# agency

This repository contains the source for a static single page site.

## Development

1. Open in GitHub Codespaces (uses the provided dev container), or use Ruby 3.2+ with Bundler locally.
2. Install dependencies via terminal: `bundle install`
3. Run locally via terminal: `bundle exec jekyll serve`

The site will be available at http://localhost:4000.

## Individual offers

Offer pages use the `offer` layout and a content file in `_data/offers/`.
Set `offer_id` to the data file name, `css_id` to `offer-page`, and provide
the usual title, description, and permalink in the page front matter.
The booking `action_link` names a URL in `_config.yml`; the offer's single
`price` value also replaces `[price]` in process copy and related overview
descriptions. Sections can be omitted from the data when they do not apply.
Set `data_key` when a page needs an existing data file's footer fine print.

## License

The HTML structure and site code in this repository are licensed under the MIT License.

The written content and copy are © Michael Basil.  
All rights reserved unless otherwise noted.
