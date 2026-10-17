import scrapy
from scrapy import Request


class ProductReviewAmazonComSpider(scrapy.Spider):
    name = 'product_review_amazon_com'
    start_urls = ['https://www.amazon.com/dp/B07Q6H83VY']

    def start_requests(self):
        yield Request(self.url)

    def parse(self, response):
        print("Parsing")
        print(response)
        # print("Full HTML fetched:")
        # print(response.text)
        for row in response.xpath('//div[@class="a-section review aok-relative"]'):  # response.css("div.review"): # response.css('div#cm-cr-dp-review-list'): # response.css('div.reviews-content'): # response.css("div.review-views"):
            print(row)
            item = {}

            item['author'] = row.css('span.a-profile-name::text').extract_first()

            rating = row.css('i.review-rating > span::text').extract_first().strip().split(' ')[0]
            item['rating'] = int(float(rating.strip().replace(',', '.')))

            item['title'] = row.css('span.review-title > span::text').extract_first()
            created_date = row.css('span.review-date::text').extract_first().strip()
            item['created_date'] = created_date

            review_content = row.css('div.reviewText ::text').extract()
            review_content = [rc.strip() for rc in review_content if rc.strip()]
            item['content'] = ', '.join(review_content)

            print(item)
            yield item
